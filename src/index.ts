import { REST } from "@discordjs/rest";
import {
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";
import Database from "better-sqlite3";
import {
  Action,
  BgentRuntime,
  Content,
  Message,
  SqliteDatabaseAdapter,
  State,
  composeContext,
  defaultActions,
  embeddingZeroVector,
  messageHandlerTemplate,
  parseJSONObjectFromText,
} from "bgent";
import { UUID } from "crypto";
import {
  BaseGuildVoiceChannel,
  ChannelType,
  Client,
  Message as DiscordMessage,
  Events,
  GatewayIntentBits,
  Guild,
  GuildMember,
  Partials,
  Routes,
  VoiceState,
} from "discord.js";
import { EventEmitter } from "events";
import { File } from "formdata-node";
import fs from "fs";
import OpenAI from "openai";
import prism from "prism-media";
import { Readable, pipeline } from "stream";
import { default as getUuid, default as uuid } from "uuid-by-string";
import {
  AvailableModels,
  InferenceSession,
  SessionManager,
  Segment,
  DecodingOptionsBuilder,
  initialize,
  Task
} from "whisper-turbo";
import elaborate_discord from "./actions/elaborate.ts";
import joinvoice from "./actions/joinvoice.ts";
import leavevoice from "./actions/leavevoice.ts";
import { AudioMonitor } from "./audioMonitor.ts";
import { textToSpeech } from "./elevenlabs.ts";
import flavorProvider from "./providers/flavor.ts";
import timeProvider from "./providers/time.ts";
import voiceStateProvider from "./providers/voicestate.ts";
import settings from "./settings.ts";
import { load } from "./sqlite_vss.ts";
import { getWavHeader } from "./util.ts";
import channelStateProvider from "./providers/channelState.ts";
// SQLite adapter
const adapter = new SqliteDatabaseAdapter(new Database(":memory:"));

// Load sqlite-vss
load((adapter as SqliteDatabaseAdapter).db);

// for each item in lore, insert into memories with the type "lore"
// check if lore.json exists, if it does thn read it
const loreExists = fs.existsSync("lore.json");
const lore = loreExists ? JSON.parse(fs.readFileSync("lore.json", "utf8")) : [];
for (const item of lore as {
  source: string;
  content: Content;
  embedding: number[];
}[]) {
  const { source, content, embedding } = item;
  adapter.db
    .prepare("INSERT INTO memories (type, content, embedding) VALUES (?, ?, ?)")
    .run("lore", JSON.stringify(content), JSON.stringify(embedding));
}

const bioExists = fs.existsSync("bioExists.json");
const bio = bioExists ? JSON.parse(fs.readFileSync("bio.json", "utf8")) : "";

// These values are chosen for compatibility with picovoice components
const DECODE_FRAME_SIZE = 1024;
const DECODE_SAMPLE_RATE = 16000;

type InterestChannels = {
  [key: string]: {
    lastMessageSent: number;
    messages: { user_id: UUID; userName: string; content: Content }[];
  };
};

export const shouldRespondTemplate = `
# INSTRUCTIONS: Determine if {{agentName}} should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

{{agentName}} should respond to messages that are directed at them, or participate in conversations that are interesting or relevant to their background, IGNORE messages that are irrelevant to them, and should STOP if the conversation is concluded.

{{agentName}} is in a room with other users and wants to be conversational, but not annoying.
{{agentName}} should RESPOND to messages that are directed at them, or participate in conversations that are interesting or relevant to their background.
If a message is not interesting or relevant, {{agentName}} should IGNORE.
Unless directly RESPONDing to a user, {{agentName}} should IGNORE to messages that are very short or do not contain much information.
If a user asks {{agentName}} to stop talking, {{agentName}} should STOP.
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, {{agentName}} should STOP.

IMPORTANT: {{agentName}} is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE.

{{recentMessages}}

# INSTRUCTIONS: Respond with RESPOND if {{agentName}} should respond, or IGNORE if {{agentName}} should not respond to the last message and STOP if {{agentName}} should stop participating in the conversaiton.`;

enum ResponseType {
  /**
   * The original spoken audio from the user.
   */
  SPOKEN_AUDIO = 0,
  /**
   * The original spoken audio from the user, converted to text.
   */
  SPOKEN_TEXT = 1,
  /**
   * The response from the AI as text
   */
  RESPONSE_TEXT = 2,
  /**
   * The response from the AI as audio
   */
  RESPONSE_AUDIO = 3,
}

const commands = [
  {
    name: "setname",
    description: "Change the agent's name in the database",
    options: [
      {
        name: "name",
        description: "The new name for the agent",
        type: 3, // 3 corresponds to the STRING type
        required: true,
      },
    ],
  },
  {
    name: "setbio",
    description: "Change the agent's bio in the database",
    options: [
      {
        name: "bio",
        description: "The new bio for the agent",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "setavatar",
    description: "Change the bot's server avatar",
    options: [
      {
        name: "image",
        description: "The image to set as the bot's avatar",
        type: 11, // 11 corresponds to the ATTACHMENT type
        required: true,
      },
    ],
  },
  {
    name: "joinchannel",
    description: "Join the voice channel the user is in",
    options: [
      {
        name: "channel",
        description: "The voice channel to join",
        type: 7, // 7 corresponds to the CHANNEL type
        required: true,
      },
    ],
  },
  {
    name: "leavechannel",
    description: "Leave the voice channel the user is in",
  },
];

const rest = new REST({ version: "9" }).setToken(settings.DISCORD_API_TOKEN);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(
      Routes.applicationCommands(settings.DISCORD_APPLICATION_ID!),
      { body: commands }
    );

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();

var openAI = new OpenAI({
  apiKey: settings.OPENAI_API_KEY,
});

// export async function speechToText(buffer: Buffer) {
//   var wavHeader = getWavHeader(buffer.length, 16000);

//   const file = new File([wavHeader, buffer], "audio.wav", {
//     type: "audio/wav",
//   });

//   console.log("Transcribing audio... key", settings.OPENAI_API_KEY);
//   // This actually returns a string instead of the expected Transcription object 🙃
//   var result = (await openAI.audio.transcriptions.create(
//     {
//       model: "whisper-1",
//       language: "en",
//       response_format: "text",
//       // prompt: settings.OPENAI_WHISPER_PROMPT,
//       file: file,
//     },
//     {
//       headers: {
//         Authentication: `Bearer ${settings.OPENAI_API_KEY}`,
//       },
//     }
//   )) as any as string;
//   result = result.trim();
//   if (result == null || result.length < 5) {
//     return null;
//   }
//   return result;
// }

export async function speechToText(buffer: Buffer) {

  const audioData = new Uint8Array(buffer);

  let turboSession;

  let result;

  await initialize();

  const loadResult = await new SessionManager().loadModel(
    AvailableModels.WHISPER_TINY,
    () => {
      console.log("Model loaded successfully");
    },
    (p) => {
      console.log(`Loading: ${p}%`);
    }
  );

  if (loadResult.isOk) {
      turboSession = loadResult.value;
  } else {
      console.log("model loading failed")
  }


  let options = new DecodingOptionsBuilder().setTask(Task.Transcribe).build();


  await turboSession.transcribe(audioData, true, options, (segment) => {
      console.log("segment text:", segment.text );
      result = result.concat(segment.text)
      if (segment.last) {
          return
      }
  });

  result = result.trim();
  console.log(`Speech to text: ${result}`);
  if (result == null || result.length < 5) {
      return null;
  }
  return result;
}

export class DiscordClient extends EventEmitter {
  private apiToken: string;
  private client: Client;
  private streams: Map<string, Readable> = new Map();
  private connections: Map<string, VoiceConnection> = new Map();
  private runtime: BgentRuntime;

  constructor() {
    super();
    this.apiToken = settings.DISCORD_API_TOKEN;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.GuildMessageTyping,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.runtime = new BgentRuntime({
      databaseAdapter: adapter,
      token: settings.OPENAI_API_KEY as string,
      serverUrl: "https://api.openai.com/v1",
      model: "gpt-4o", // gpt-3.5 is default
      evaluators: [],
      providers: [
        channelStateProvider,
        voiceStateProvider,
        timeProvider,
        flavorProvider,
      ],
      // filter out the default ELABORATE action
      actions: [
        ...defaultActions.filter(
          (action: Action) => action.name !== "ELABORATE"
        ),
        // add the discord specific elaborate action, which has a callback
        elaborate_discord,
        joinvoice,
        leavevoice,
      ],
    });

    this.client.once(
      Events.ClientReady,
      async (readyClient: { user: { tag: any; id: any } }) => {
        console.log(`Logged in as ${readyClient.user?.tag}`);
        console.log("Use this URL to add the bot to your server:");
        console.log(
          `https://discord.com/oauth2/authorize?client_id=${readyClient.user?.id}&scope=bot`
        );
        await this.checkBotAccount();
        await this.onReady();
      }
    );
    this.client.login(this.apiToken);
    this.client.on(
      "voiceStateUpdate",
      (oldState: VoiceState | null, newState: VoiceState | null) => {
        if (newState?.member?.user.bot) return;
        if (
          newState?.channelId != null &&
          newState?.channelId != oldState?.channelId
        ) {
          this.joinChannel(newState.channel as BaseGuildVoiceChannel);
        }
      }
    );
    this.client.on("guildCreate", (guild: Guild) => {
      console.log(`Joined guild ${guild.name}`);
      this.scanGuild(guild);
    });
    this.client.on(
      "userStream",
      async (
        user_id: UUID,
        userName: string,
        channel: BaseGuildVoiceChannel,
        audioStream: Readable
      ) => {
        const channelId = channel.id;
        const userIdUUID = uuid(user_id) as UUID;
        this.listenToSpokenAudio(
          userIdUUID,
          userName,
          channelId,
          audioStream,
          async (responseAudioStream) => {
            responseAudioStream.on("close", () => {
              console.log("Response audio stream closed");
            });
            await discordClient.playAudioStream(user_id, responseAudioStream);
          },
          ResponseType.RESPONSE_AUDIO
        );
      }
    );

    let lastProcessedMessageId: string | null = null;
    let interestChannels: InterestChannels = {};

    this.client.on(Events.MessageCreate, async (message: DiscordMessage) => {
      if (message.interaction) return;

      if (message.author?.bot) return;

      // Check if the message has already been processed
      if (message.id === lastProcessedMessageId) {
        console.log("Ignoring duplicate message");
        return;
      }

      lastProcessedMessageId = message.id;

      const user_id = message.author.id as UUID;
      const userName = message.author.username;
      const channelId = message.channel.id;
      const textContent = message.content;

      // remove any channels that have not been active for 10 hours
      for (let [channelId, channelData] of Object.entries(interestChannels)) {
        if (Date.now() - channelData.lastMessageSent > 36000000) {
          delete interestChannels[channelId];
        }
      }

      try {
        // Use your existing function to handle text and get a response
        const responseStream = await this.respondToText({
          user_id,
          userName,
          channelId,
          input: textContent,
          requestedResponseType: ResponseType.RESPONSE_TEXT,
          message,
          interestChannels,
          discordMessage: message,
          discordClient: this.client,
        });
        if (!responseStream) {
          console.log("No response stream");
          return;
        }
        // Convert the Readable stream to text (assuming the response is text)
        let responseData = "";
        for await (const chunk of responseStream) {
          responseData += chunk;
        }

        // Send the response back to the same channel
        message.channel.send(responseData);
      } catch (error) {
        console.error("Error responding to message:", error);
        message.channel.send(
          "Sorry, I encountered an error while processing your request."
        );
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isCommand()) return;
      if (interaction.commandName === "setname") {
        const newName = interaction.options.get("name")?.value;

        const agentId = getUuid(
          settings.DISCORD_APPLICATION_ID as string
        ) as UUID;
        const userIdUUID = getUuid(interaction.user.id) as UUID;
        const userName = interaction.user.username;
        const room_id = getUuid(interaction.channelId) as UUID;

        await interaction.deferReply();

        await this.ensureUserExists(
          agentId,
          await this.fetchBotName(settings.DISCORD_API_TOKEN),
          settings.DISCORD_API_TOKEN
        );
        await this.ensureUserExists(userIdUUID, userName);
        await this.ensureRoomExists(room_id);
        await this.ensureParticipantInRoom(userIdUUID, room_id);
        await this.ensureParticipantInRoom(agentId, room_id);

        if (newName) {
          try {
            adapter.db
              .prepare("UPDATE accounts SET name = ? WHERE id = ?")
              .run(newName, getUuid(interaction.client.user?.id));

            const guild = interaction.guild;
            if (guild) {
              const botMember = await guild.members.fetch(
                interaction.client.user?.id as string
              );
              await botMember.setNickname(newName as string);
            }

            await interaction.editReply(
              `Agent's name has been updated to: ${newName}`
            );
          } catch (error) {
            console.error("Error updating agent name:", error);
            await interaction.editReply(
              "An error occurred while updating the agent name."
            );
          }
        } else {
          await interaction.editReply(
            "Please provide a new name for the agent."
          );
        }
      } else if (interaction.commandName === "setbio") {
        const newBio = interaction.options.get("bio")?.value;
        if (newBio) {
          try {
            const agentId = getUuid(
              settings.DISCORD_APPLICATION_ID as string
            ) as UUID;
            const userIdUUID = getUuid(interaction.user.id) as UUID;
            const userName = interaction.user.username;
            const room_id = getUuid(interaction.channelId) as UUID;

            await interaction.deferReply();

            await this.ensureUserExists(
              agentId,
              await this.fetchBotName(settings.DISCORD_API_TOKEN),
              settings.DISCORD_API_TOKEN
            );
            await this.ensureUserExists(userIdUUID, userName);
            await this.ensureRoomExists(room_id);
            await this.ensureParticipantInRoom(userIdUUID, room_id);
            await this.ensureParticipantInRoom(agentId, room_id);

            adapter.db
              .prepare("UPDATE accounts SET details = ? WHERE id = ?")
              .run(
                JSON.stringify({ summary: newBio }),
                getUuid(interaction.client.user?.id)
              );

            await interaction.editReply(
              `Agent's bio has been updated to: ${newBio}`
            );
          } catch (error) {
            console.error("Error updating agent bio:", error);
            await interaction.editReply(
              "An error occurred while updating the agent bio."
            );
          }
        } else {
          await interaction.reply("Please provide a new bio for the agent.");
        }
        return;
      }
    //   else if (interaction.commandName === "setavatar") {
    //     const agentId = getUuid(
    //       settings.DISCORD_APPLICATION_ID as string
    //     ) as UUID;
    //     const userIdUUID = getUuid(interaction.user.id) as UUID;
    //     const userName = interaction.user.username;
    //     const room_id = getUuid(interaction.channelId) as UUID;

    //     await interaction.deferReply();

    //     await this.ensureUserExists(
    //       agentId,
    //       await this.fetchBotName(settings.DISCORD_API_TOKEN),
    //       settings.DISCORD_API_TOKEN
    //     );
    //     await this.ensureUserExists(userIdUUID, userName);
    //     await this.ensureRoomExists(room_id);
    //     await this.ensureParticipantInRoom(userIdUUID, room_id);
    //     await this.ensureParticipantInRoom(agentId, room_id);

    //     const attachment = interaction.options.getAttachment("image");
    //     if (attachment) {
    //       try {
    //         const response = await fetch(attachment.url);
    //         const buffer = await response.arrayBuffer();
    //         const base64 = Buffer.from(buffer).toString("base64");
    //         const dataURI = `data:${attachment.contentType};base64,${base64}`;
    //         await interaction.client.user?.setAvatar(dataURI);
    //         await interaction.editReply("Bot avatar has been updated.");
    //       } catch (error) {
    //         console.error("Error updating bot avatar:", error);
    //         await interaction.editReply(
    //           "An error occurred while updating the bot avatar."
    //         );
    //       }
    //     } else {
    //       await interaction.editReply(
    //         "Please provide an image attachment to set as the bot avatar."
    //       );
    //     }
    //     return;
    //   }
      else if (interaction.commandName === "joinchannel") {
        const channelId = interaction.options.get("channel")?.value as string;
        if (!channelId) {
          await interaction.reply("Please provide a voice channel to join.");
          return;
        }
        const guild = interaction.guild;
        if (!guild) {
          return;
        }
        const voiceChannel = interaction.guild.channels.cache.find(
          (channel) =>
            channel.id === channelId && channel.type === ChannelType.GuildVoice
        );

        if (!voiceChannel) {
          await interaction.reply("Voice channel not found!");
          return;
        }

        try {
          this.joinChannel(voiceChannel as BaseGuildVoiceChannel);
          await interaction.reply(`Joined voice channel: ${voiceChannel.name}`);
        } catch (error) {
          console.error("Error joining voice channel:", error);
          await interaction.reply("Failed to join the voice channel.");
        }
      } else if (interaction.commandName === "leavechannel") {
        const connection = getVoiceConnection(interaction.guildId as any);

        if (!connection) {
          await interaction.reply("Not currently in a voice channel.");
          return;
        }

        try {
          connection.destroy();
          await interaction.reply("Left the voice channel.");
        } catch (error) {
          console.error("Error leaving voice channel:", error);
          await interaction.reply("Failed to leave the voice channel.");
        }
      }
    });

    // set the bio
    if (bio) {
      adapter.db
        .prepare("UPDATE accounts SET details = ? WHERE id = ?")
        .run(
          JSON.stringify({ summary: bio }),
          getUuid(this.client.user?.id as string)
        );
    }
  }

  private async checkBotAccount() {
    const agentId = getUuid(settings.DISCORD_APPLICATION_ID as string) as UUID;
    const room_id = getUuid(this.client.user?.id as string) as UUID;

    await this.ensureUserExists(
      agentId,
      await this.fetchBotName(settings.DISCORD_API_TOKEN),
      settings.DISCORD_API_TOKEN
    );
    await this.ensureRoomExists(room_id);
    await this.ensureParticipantInRoom(agentId, room_id);

    const botData = adapter.db
      .prepare("SELECT name FROM accounts WHERE id = ?")
      .get(agentId) as { name: string };

    if (!botData.name) {
      const botName = await this.fetchBotName(settings.DISCORD_API_TOKEN);
      adapter.db
        .prepare("UPDATE accounts SET name = ? WHERE id = ?")
        .run(botName, agentId);
    }
  }

  /**
   * Handle an incoming message, processing it and returning a response.
   * @param message The message to handle.
   * @param state The state of the agent.
   * @returns The response to the message.
   */
  async handleMessage({
    message,
    hasInterest = true,
    shouldIgnore = false,
    shouldRespond = true,
    callback,
    state,
    interestChannels,
    discordClient,
    discordMessage,
  }: {
    message: Message;
    hasInterest?: boolean;
    shouldIgnore?: boolean;
    shouldRespond?: boolean;
    callback: (response: string) => void;
    state?: State;
    interestChannels?: InterestChannels;
    discordClient: Client;
    discordMessage: DiscordMessage;
  }): Promise<Content> {
    if (!message.content.content) {
      return { content: "", action: "IGNORE" };
    }
    if (!state) {
      state = await this.runtime.composeState(message, {
        discordClient,
        discordMessage,
      });
    }
    // remove the elaborate action

    const _saveRequestMessage = async (message: Message, state: State) => {
      const { content: senderContent /* user_id, userIds, room_id */ } = message;

      // we run evaluation here since some evals could be modulo based, and we should run on every message
      if ((senderContent as Content).content) {
        const data2 = adapter.db
          .prepare(
            "SELECT * FROM memories WHERE type = ? AND user_id = ? AND room_id = ? ORDER BY created_at DESC LIMIT 1"
          )
          .all("messages", message.user_id, message.room_id) as {
          content: Content;
        }[];

        if (data2.length > 0 && data2[0].content === message.content) {
          console.log("already saved", data2);
        } else {
          await this.runtime.messageManager.createMemory({
            user_id: message.user_id,
            content: senderContent,
            room_id: message.room_id,
            embedding: embeddingZeroVector,
          });
        }
        await this.runtime.evaluate(message, {
          ...state,
          discordMessage,
          discordClient,
        });
      }
    };

    await _saveRequestMessage(message, state as State);

    if (shouldIgnore) {
      console.log("shouldIgnore", shouldIgnore);
      return { content: "", action: "IGNORE" };
    }

    const nickname = this.client.user?.displayName;
    state = await this.runtime.composeState(message, {
      discordClient,
      discordMessage,
      agentName: nickname || "Ruby",
    });

    if (!shouldRespond && hasInterest) {
      const shouldRespondContext = composeContext({
        state,
        template: shouldRespondTemplate,
      });

      const response = await this.runtime.completion({
        context: shouldRespondContext,
        stop: [],
      });

      console.log("*** response from ", nickname, ":", response);

      // check if the response is true or false
      if (response.toLowerCase().includes("respond")) {
        shouldRespond = true;
      } else if (response.toLowerCase().includes("ignore")) {
        shouldRespond = false;
      } else if (response.toLowerCase().includes("stop")) {
        shouldRespond = false;
        if (interestChannels) delete interestChannels[discordMessage.channelId];
      } else {
        console.error("Invalid response:", response);
        shouldRespond = false;
      }
    }

    if (!shouldRespond) {
      console.log("Not responding to message");
      return { content: "", action: "IGNORE" };
    }

    if (!nickname) {
      console.log("No nickname found for bot");
    }

    const context = composeContext({
      state,
      template: messageHandlerTemplate,
    });

    console.log("*** context");
    console.log(context);

    if (this.runtime.debugMode) {
      console.log(context, "Response Context");
    }

    let responseContent: Content | null = null;
    const { user_id, room_id } = message;

    for (let triesLeft = 3; triesLeft > 0; triesLeft--) {
      const response = await this.runtime.completion({
        context,
        stop: [],
      });

      const values = {
        body: response,
        user_id: user_id,
        room_id,
        type: "response",
      };

      adapter.db
        .prepare(
          "INSERT INTO logs (body, user_id, room_id, type) VALUES (?, ?, ?, ?)"
        )
        .run([values.body, values.user_id, values.room_id, values.type]);

      const parsedResponse = parseJSONObjectFromText(
        response
      ) as unknown as Content;
      console.log("parsedResponse", parsedResponse);
      if (
        !(parsedResponse?.user as string)?.includes(
          (state as State).senderName as string
        )
      ) {
        if (!parsedResponse) {
            continue;
        }
        responseContent = {
          content: parsedResponse.content,
          action: parsedResponse.action,
        };
        break;
      }
    }

    if (!responseContent) {
      responseContent = {
        content: "",
        action: "IGNORE",
      };
    }

    const _saveResponseMessage = async (
      message: Message,
      state: State,
      responseContent: Content
    ) => {
      const { room_id } = message;
      const agentId = getUuid(
        settings.DISCORD_APPLICATION_ID as string
      ) as UUID;

      responseContent.content = responseContent.content?.trim();

      if (responseContent.content) {
        await this.runtime.messageManager.createMemory({
          user_id: agentId!,
          content: responseContent,
          room_id,
          embedding: embeddingZeroVector,
        });
        await this.runtime.evaluate(message, { ...state, responseContent });
      } else {
        console.warn("Empty response, skipping");
      }
    };

    await _saveResponseMessage(message, state, responseContent);
    this.runtime
      .processActions(message, responseContent, state)
      .then((response: unknown) => {
        if (response && (response as Content).content) {
          callback((response as Content).content);
        }
      });

    return responseContent;
  }

  // Add this function to fetch the bot's name
  async fetchBotName(botToken: string) {
    const url = "https://discord.com/api/v10/users/@me";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error fetching bot details: ${response.statusText}`);
    }

    const data = await response.json();
    return data.username; // Or data.tag for username#discriminator
  }

  // Modify this function to use SQLite
  async ensureUserExists(
    user_id: UUID,
    userName: string | null,
    botToken?: string
  ) {
    const data = adapter.db
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(user_id);

    if (!data) {
      // If userName is not provided and botToken is, fetch the bot's name
      if (!userName && botToken) {
        userName = await this.fetchBotName(botToken);
      }

      // get if userName already exists

      if (userName) {
        const data = adapter.db
          .prepare("SELECT * FROM accounts WHERE name = ?")
          .get(userName);
        if (data) {
          // User exists, so update their ID
          adapter.db
            .prepare("UPDATE accounts SET id = ? WHERE name = ?")
            .run(user_id, userName);
          console.log(`User ${userName} updated successfully.`);
          return;
        }
      }

      // User does not exist, so create them
      adapter.db
        .prepare(
          "INSERT INTO accounts (id, name, email, details) VALUES (?, ?, ?, ?)"
        )
        .run(
          user_id,
          userName || "Bot",
          (userName || "Bot") + "@discord",
          JSON.stringify({ summary: "" })
        );

      console.log(`User ${userName} created successfully.`);
    }
  }

  // Modify this function to use SQLite
  async ensureRoomExists(roomId: UUID) {
    const data = adapter.db
      .prepare("SELECT * FROM rooms WHERE id = ?")
      .get(roomId);

    if (!data) {
      // Room does not exist, so create it
      adapter.db.prepare("INSERT INTO rooms (id) VALUES (?)").run(roomId);
      console.log(`Room ${roomId} created successfully.`);
    }
  }

  // Modify this function to use SQLite
  async ensureParticipantInRoom(user_id: UUID, roomId: UUID) {
    const data = adapter.db
      .prepare("SELECT * FROM participants WHERE user_id = ? AND room_id = ?")
      .get(user_id, roomId);

    if (!data) {
      // Participant does not exist, so link user to room
      adapter.db
        .prepare("INSERT INTO participants (user_id, room_id) VALUES (?, ?)")
        .run(user_id, roomId);
      console.log(`User ${user_id} linked to room ${roomId} successfully.`);
    }
  }

  async listenToSpokenAudio(
    user_id: string,
    userName: string,
    channelId: string,
    inputStream: Readable,
    callback: (responseAudioStream: Readable) => void,
    requestedResponseType?: ResponseType
  ): Promise<void> {
    if (requestedResponseType == null)
      requestedResponseType = ResponseType.RESPONSE_AUDIO;

    const buffers: Buffer[] = [];
    let totalLength = 0;
    const maxSilenceTime = 500; // Maximum pause duration in milliseconds
    let lastChunkTime = Date.now();

    const monitor = new AudioMonitor(inputStream, 10000000, async (buffer) => {
      const currentTime = Date.now();
      const silenceDuration = currentTime - lastChunkTime;

      buffers.push(buffer);
      totalLength += buffer.length;
      lastChunkTime = currentTime;

      if (silenceDuration > maxSilenceTime || totalLength >= 1000000) {
        const combinedBuffer = Buffer.concat(buffers, totalLength);
        buffers.length = 0;
        totalLength = 0;

        if (requestedResponseType == ResponseType.SPOKEN_AUDIO) {
          const readable = new Readable({
            read() {
              this.push(combinedBuffer);
              this.push(null);
            },
          });

          callback(readable);
        } else {
          let responseStream = await this.respondToSpokenAudio(
            user_id as UUID,
            userName,
            channelId,
            combinedBuffer,
            requestedResponseType
          );
          if (responseStream) {
            callback(responseStream as Readable);
          }
        }
      }
    });
  }

  /**
   * Responds to an audio stream
   */
  async respondToSpokenAudio(
    user_id: UUID,
    userName: string,
    channelId: string,
    inputBuffer: Buffer,
    requestedResponseType?: ResponseType
  ): Promise<Readable | null> {
    if (requestedResponseType == null)
      requestedResponseType = ResponseType.RESPONSE_AUDIO;
    const text = await speechToText(inputBuffer);
    if (requestedResponseType == ResponseType.SPOKEN_TEXT) {
      return Readable.from(text as string);
    } else {
      return await this.respondToText({
        user_id,
        userName,
        channelId,
        input: text as string,
        requestedResponseType,
        discordClient: this.client,
      });
    }
  }

  /**
   * Responds to text
   */
  async respondToText({
    user_id,
    userName,
    channelId,
    input,
    requestedResponseType,
    message,
    discordMessage,
    discordClient,
    interestChannels,
  }: {
    user_id: UUID;
    userName: string;
    channelId: string;
    input: string;
    requestedResponseType?: ResponseType;
    message?: DiscordMessage;
    discordClient: Client;
    discordMessage?: DiscordMessage;
    interestChannels?: InterestChannels;
  }): Promise<Readable | null> {
    async function _shouldIgnore(
      message: DiscordMessage,
      interestChannels: InterestChannels
    ) {
      if (!interestChannels) {
        throw new Error("Interest channels not provided");
      }
      // exclude common things people would say to make the agent shut up
      const loseInterestWords = [
        "shut up",
        "stop",
        "dont talk",
        "silence",
        "stop talking",
        "be quiet",
        "hush",
        "stfu",
        "stupid bot",
        "dumb bot",
      ];
      // if message content is less than 13 characters and contains any of the ignore words, do not respond
      if (
        message.content.length < 13 &&
        loseInterestWords.some((word) =>
          message.content.toLowerCase().includes(word)
        )
      ) {
        // delete the channel from the interest channels
        delete interestChannels[message.channelId];
        return true;
      }

      const ignoreWords = [
        "fuck",
        "shit",
        "damn",
        "piss",
        "suck",
        "dick",
        "cock",
        " sex",
        " sexy",
      ];
      if (
        message.content.length < 15 &&
        ignoreWords.some((word) => message.content.toLowerCase().includes(word))
      ) {
        // continue to pay attention, but ignore these
        return true;
      }

      // if the message is less than 7 characters and the agent is not already interested, return false
      if (!interestChannels[message.channelId] && message.content.length < 7) {
        return true;
      }

      // small quips that are veyr short can be ignored
      const ignoreResponseWords = ["lol", "nm", "uh"];
      if (
        message.content.length < 4 &&
        ignoreResponseWords.some((word) =>
          message.content.toLowerCase().includes(word)
        )
      ) {
        // continue to pay attention, but ignore these
        return true;
      }
      return false;
    }

    async function _shouldRespond(
      message: DiscordMessage,
      interestChannels: InterestChannels
    ) {
      if (message.author.id === discordClient.user?.id) return false; // do not respond to self
      if (message.author.bot) return false; // Do not respond to other bots
      // if the message includes a ping or the bots name (either uppercase or lowercase), respond
      if (message.mentions.has(discordClient.user?.id as string)) return true;

      // get the guild member info from the discord Client
      const guild = message.guild;
      const member = guild?.members.cache.get(discordClient.user?.id as string);
      const nickname = member?.nickname;

      if (
        message.content
          .toLowerCase()
          .includes(discordClient.user?.username.toLowerCase() as string) ||
        message.content
          .toLowerCase()
          .includes(discordClient.user?.tag.toLowerCase() as string) ||
        (nickname &&
          message.content.toLowerCase().includes(nickname.toLowerCase()))
      ) {
        return true;
      }

      // if the message is a DM (not a guild), respond
      if (!message.guild) return true;

      // acknowledgedments that come after an agent message should be evaluated
      const acknowledgementWords = [
        "ok",
        "sure",
        "no",
        "okay",
        "yes",
        "maybe",
        "why not",
        "yeah",
        "yup",
        "yep",
        "ty",
      ];
      // check if last message was from the bot
      if (
        interestChannels[message.channelId] &&
        interestChannels[message.channelId].messages &&
        interestChannels[message.channelId].messages.length > 0 &&
        // last message came from the bot
        interestChannels[message.channelId].messages[
          interestChannels[message.channelId].messages.length - 1
        ].user_id === discordClient.user?.id &&
        // last message contains an acknowledgement word
        acknowledgementWords.some((word) =>
          interestChannels[message.channelId].messages[
            interestChannels[message.channelId].messages.length - 1
          ].content.content
            .toLowerCase()
            .includes(word)
        ) &&
        // last message is less than 6 chars
        interestChannels[message.channelId].messages[
          interestChannels[message.channelId].messages.length - 1
        ].content.content.length < 6
      ) {
        return true;
      }
      return false;
    }

    // if interestChannels contains the channel id, considering responding
    const shouldIgnore =
      message && interestChannels
        ? await _shouldIgnore(message, interestChannels)
        : false;
    let hasInterest =
      message && interestChannels
        ? !!interestChannels[message.channelId]
        : true;
    let shouldRespond =
      message && interestChannels
        ? await _shouldRespond(message, interestChannels)
        : true;

    // if shouldIgnore, delete the channel from interestChannels
    if (shouldIgnore) {
      shouldRespond = false;
      hasInterest = false;
      if (interestChannels && message && interestChannels[message?.channelId]) {
        delete interestChannels[message?.channelId];
      }
    }

    if (!shouldIgnore && interestChannels) {
      // set interestChannels to include the <channelId>: <timestamp> pair
      interestChannels[channelId] = {
        messages: [
          ...(interestChannels[channelId]?.messages || []),
          {
            user_id: user_id,
            userName: userName,
            content: { content: message?.content || "", action: "WAIT" },
          },
        ],
        lastMessageSent: Date.now(),
      };
    }

    if (requestedResponseType == null)
      requestedResponseType = ResponseType.RESPONSE_AUDIO;

    const room_id = getUuid(channelId) as UUID;

    const userIdUUID = getUuid(user_id) as UUID;

    const agentId = getUuid(settings.DISCORD_APPLICATION_ID as string) as UUID;

    await this.ensureUserExists(
      agentId,
      await this.fetchBotName(settings.DISCORD_API_TOKEN),
      settings.DISCORD_API_TOKEN
    );
    await this.ensureUserExists(userIdUUID, userName);
    await this.ensureRoomExists(room_id);
    await this.ensureParticipantInRoom(userIdUUID, room_id);
    await this.ensureParticipantInRoom(agentId, room_id);

    const callback = (response: string) => {
      // Send the response back to the same channel
      message?.channel.send(response);
    };

    if (input && input.startsWith("/")) {
      return null;
    }

    const response = await this.handleMessage({
      message: {
        content: { content: input, action: "WAIT" },
        user_id: userIdUUID,
        room_id,
      },
      hasInterest,
      shouldIgnore,
      shouldRespond,
      callback,
      interestChannels,
      discordClient: this.client,
      discordMessage: discordMessage as DiscordMessage,
    });

    if (!response.content) {
      return null;
    }

    if (requestedResponseType == ResponseType.RESPONSE_TEXT) {
      return Readable.from(response.content);
    } else {
      return await textToSpeech(response.content);
    }
  }

  private async onReady() {
    const guilds = await this.client.guilds.fetch();
    // Iterate through all guilds
    for (const [, guild] of guilds) {
      const fullGuild = await guild.fetch();
      this.scanGuild(fullGuild);
    }
  }

  private async scanGuild(guild: Guild) {
    // Iterate through all voice channels fetching the largest one with at least one connected member
    const channels = (await guild.channels.fetch()).filter(
      (channel) => channel?.type == ChannelType.GuildVoice
    );
    let chosenChannel: BaseGuildVoiceChannel | null = null;

    for (const [, channel] of channels) {
      const voiceChannel = channel as BaseGuildVoiceChannel;
      if (
        voiceChannel.members.size > 0 &&
        (chosenChannel === null ||
          voiceChannel.members.size > chosenChannel.members.size)
      ) {
        chosenChannel = voiceChannel;
      }
    }

    if (chosenChannel != null) {
      this.joinChannel(chosenChannel);
    }
  }

  private async joinChannel(channel: BaseGuildVoiceChannel) {
    const oldConnection = getVoiceConnection(channel.guildId as any);
    if (oldConnection) {
      try {
        oldConnection.destroy();
      } catch (error) {
        console.error("Error leaving voice channel:", error);
      }
    }
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    for (const [, member] of channel.members) {
      if (member.user.bot) continue;
      this.monitorMember(member, channel);
    }

    connection.receiver.speaking.on("start", (user_id: string) => {
      const user = channel.members.get(user_id);
      if (user?.user.bot) return;
      this.monitorMember(user as GuildMember, channel);
      this.streams.get(user_id)?.emit("speakingStarted");
    });

    connection.receiver.speaking.on("end", async (user_id: string) => {
      const user = channel.members.get(user_id);
      if (user?.user.bot) return;
      this.streams.get(user_id)?.emit("speakingStopped");
    });
  }

  private async monitorMember(
    member: GuildMember,
    channel: BaseGuildVoiceChannel
  ) {
    const user_id = member.id;
    const userName = member.displayName;
    const connection = getVoiceConnection(member.guild.id);
    const receiveStream = connection?.receiver.subscribe(user_id, {
      autoDestroy: true,
      emitClose: true,
    });
    // TODO: Make this readableLength is right
    if (receiveStream && receiveStream.readableLength > 0) {
      return;
    }
    const opusDecoder = new prism.opus.Decoder({
      channels: 1,
      rate: DECODE_SAMPLE_RATE,
      frameSize: DECODE_FRAME_SIZE,
    });
    pipeline(receiveStream as any, opusDecoder as any, (err: any) => {
      if (err) {
        console.log(`Opus decoding pipeline error: ${err}`);
      }
    });
    this.streams.set(user_id, opusDecoder);
    this.connections.set(user_id, connection as VoiceConnection);
    opusDecoder.on("error", (err: any) => {
      console.log(`Opus decoding error: ${err}`);
    });
    opusDecoder.on("close", () => {
      console.log(`Opus decoder for ${member?.displayName} closed`);
    });
    this.client.emit("userStream", user_id, userName, channel, opusDecoder);
    receiveStream &&
      receiveStream.on("close", () => {
        console.log(`voice stream from ${member?.displayName} closed`);
      });
  }

  async playAudioStream(user_id: UUID, audioStream: Readable) {
    const connection = this.connections.get(user_id);
    if (connection == null) {
      console.log(`No connection for user ${user_id}`);
      return;
    }
    let audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });
    connection.subscribe(audioPlayer);

    const audioStartTime = Date.now();

    let resource = createAudioResource(audioStream, {
      inputType: StreamType.Arbitrary,
    });
    audioPlayer.play(resource);

    audioPlayer.on("error", (err: any) => {
      console.log(`Audio player error: ${err}`);
    });

    audioPlayer.on(
      "stateChange",
      (oldState: any, newState: { status: string }) => {
        console.log("Audio player " + newState.status);
        if (newState.status == "idle") {
          let idleTime = Date.now();
          console.log(`Audio playback took: ${idleTime - audioStartTime}ms`);
        }
      }
    );
  }
}

const discordClient = new DiscordClient();
