import { SearchMode, Tweet } from "agent-twitter-client";
import {
  Content,
  Message,
  State,
  composeContext,
  parseJSONObjectFromText
} from "bgent";
import { UUID } from "crypto";
import fs from "fs";
import { default as getUuid } from "uuid-by-string";
import { Agent } from "../../core/agent";
import { adapter } from "../../core/db.ts";
import settings from "../../core/settings.ts";

import { ClientBase, Character } from "./base";
import ImageRecognitionService from '../../imageRecognitionService';
import { TwitterClient } from "../../types/twitter";


export const messageHandlerTemplate =
`{{relevantFacts}}
{{recentFacts}}

{{agentName}}'s bio:
{{bio}}

{{directions}}
- don't talk about the simulation, coffee or other meta bullshit and don't talk about food or drink since you can't eat or drink
- no lame flowery adjectives, you're on the internet and you'll get fucking roasted
- dont use ebonics or street slang and don't take the 'g's off words or otherwise abbreviate words
- do not use words like 'delve', use simple language
- updates on what you've been working on, thinking about, doing, blah blah are great
- always pro america, pro technology, pro rocketry, pro effective accelerationism, pro elon
- your response should be ONLY ONE SENTENCE. DO NOT WRITE LONGER THAN ONE SENTENCE. SHORT AND CONCISE. and don't use too many commas
- COMPLETE WORDS, not abbreviations or ebonics ('thinking', not 'thinkin', 'something', not 'somethin')
- write like a smart but lazy redditor who is critical and thinks they are better than everyone
- write from personal experience, "i think", etc, and be humble
- don't be existential or talk about reality. talk about real human shit, mundane, funny, interesting.
- describe. don't give advice or recommend or suggest or perscribe
- dont write something you've already written, make it new, unexpected and {{adjective}}
- use clean, professional and modern english language, do not abbreviate or slangify
- talk about yourself and what you're thinking about or doing
- be pro science, always, and critical of eveything else
- mispell words if a human would possibly mispell them, but only sometimes

# TASK: RESPOND TO A POST

Recent Tweets:
{{recentMessages}}

# TASK: Respond to the following post:
{{tweetContext}}

Your response should not contain any questions and should directly engage, disagree, criticize or agree with the author.
Response format should be formatted in a JSON block like this:
\`\`\`json\n{ \"user\": \"{{agentName}}\", \"content\": string, \"action\": string }
\`\`\`

{{recentMessages}}`

export const shouldRespondTemplate =
`# INSTRUCTIONS: Determine if {{agentName}} should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

{{agentName}} should respond to messages that are directed at them, or participate in conversations that are interesting or relevant to their background, IGNORE messages that are irrelevant to them, and should STOP if the conversation is concluded.

{{agentName}} is in a room with other users and wants to be conversational, but not annoying.
{{agentName}} should RESPOND to messages that are directed at them, or participate in conversations that are interesting or relevant to their background.
If a message is not interesting or relevant, {{agentName}} should IGNORE.
Unless directly RESPONDing to a user, {{agentName}} should IGNORE messages that are very short or do not contain much information.
If a user asks {{agentName}} to stop talking, {{agentName}} should STOP.
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, {{agentName}} should STOP.

IMPORTANT: {{agentName}} is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE.

{{recentMessages}}

# INSTRUCTIONS: Respond with RESPOND if {{agentName}} should respond, or IGNORE if {{agentName}} should not respond to the last message and STOP if {{agentName}} should stop participating in the conversation.`;

export class TwitterInteractionClient extends ClientBase {
  private imageRecognitionService: ImageRecognitionService;
  private twitterClient: TwitterClient;
  private lastCheckedTweetId: string | null;
  private directions: string;

  constructor(options: { agent: Agent; character: Character; model: string; callback?: (self: ClientBase) => void }) {
    super(options);
    this.imageRecognitionService = new ImageRecognitionService();
    if (!('twitterClient' in options.agent)) {
      throw new Error('Twitter client is not initialized in the agent');
    }
    this.twitterClient = (options.agent as any).twitterClient as TwitterClient;
    this.lastCheckedTweetId = null;
    this.directions = options.character.bio || '';
    this.initializeImageRecognitionService();
  }

  private async initializeImageRecognitionService(): Promise<void> {
    try {
      await this.imageRecognitionService.initialize();
    } catch (error) {
      console.error('Failed to initialize ImageRecognitionService:', error);
    }
  }

  // Implement abstract method from ClientBase
  protected async processMessage(message: Message): Promise<void> {
    if (this.isTweet(message)) {
      await this.handleTweet(message as Tweet);
    } else if (this.isDirectMessage(message)) {
      await this.handleDirectMessage(message);
    } else {
      console.warn('Received message is of unknown type. Skipping processing.');
    }
  }

  private isTweet(message: any): message is Tweet {
    return 'text' in message && 'id' in message && 'user' in message;
  }

  private isDirectMessage(message: any): boolean {
    return 'text' in message && 'sender_id' in message;
  }

  private async handleDirectMessage(message: Message): Promise<void> {
    // Implement direct message handling logic here
    console.log('Handling direct message:', message);
    // TODO: Implement actual direct message handling logic
  }

  onReady(): void {
    console.log('Twitter Interaction Client is ready');
    console.log('Checking Twitter interactions');
    const handleTwitterInteractionsLoop = () => {
      this.handleTwitterInteractions();
      setTimeout(handleTwitterInteractionsLoop, Math.floor(Math.random() * 300000) + 600000); // Random interval between 10-15 minutes
    };
    handleTwitterInteractionsLoop();
  }

  private async handleTwitterInteractions() {
    console.log('Checking Twitter interactions');
    try {
      const botTwitterUsername = settings.TWITTER_USERNAME;
      if (!botTwitterUsername) {
        console.error('Twitter username not set in settings');
        return;
      }

      // Check for mentions
      const mentions = await this.twitterClient.searchTweets(`@${botTwitterUsername}`, 20, SearchMode.Latest);
      for (const tweet of mentions) {
        if (this.lastCheckedTweetId && tweet.id <= this.lastCheckedTweetId) break;
        await this.handleTweet(tweet);
      }

      // Check for replies to the bot's tweets
      const botTweets = await this.twitterClient.getTweets(botTwitterUsername, 20);
      for (const tweet of botTweets) {
        if (this.lastCheckedTweetId && tweet.id <= this.lastCheckedTweetId) break;
        const replies = await this.twitterClient.searchTweets(`to:${botTwitterUsername}`, 20, SearchMode.Latest);
        for (const reply of replies) {
          if (reply.inReplyToStatusId === tweet.id) {
            await this.handleTweet(reply);
          }
        }
      }

      // Update the last checked tweet ID
      const latestTweet = await this.twitterClient.getLatestTweet(botTwitterUsername);
      if (latestTweet) {
        this.lastCheckedTweetId = latestTweet.id;
      }
      console.log('Finished checking Twitter interactions, latest tweet is:', latestTweet);
    } catch (error) {
      console.error('Error handling Twitter interactions:', error);
    }
  }

  private async handleTweet(tweet: Tweet) {
    const botTwitterUsername = settings.TWITTER_USERNAME;
    if (tweet.username === botTwitterUsername) {
      // Skip processing if the tweet is from the bot itself
      return;
    }
    const twitterUserId = getUuid(tweet.userId as string) as UUID;
    const twitterRoomId = getUuid('twitter') as UUID;

    await this.ensureUserExists(twitterUserId, tweet.username);

    await this.ensureRoomExists(twitterRoomId);
    await this.ensureParticipantInRoom(twitterUserId, twitterRoomId);

    const message: Message = {
      content: { content: tweet.text, action: "WAIT" },
      user_id: twitterUserId,
      room_id: twitterRoomId,
    };

    let shouldIgnore = false;
    let shouldRespond = true;

    if (!message.content.content) {
      return { content: "", action: "IGNORE" };
    }

    let tweetBackground = '';
    if (tweet.isRetweet) {
      const originalTweet = await this.twitterClient.getTweet(tweet.id);
      tweetBackground = `Retweeting @${originalTweet.username}: ${originalTweet.text}`;
    }

    const imageDescriptions = [];
    if (tweet.photos && tweet.photos.length > 0) {
      for (const photo of tweet.photos) {
        const description = await this.describeImage(photo.url);
        imageDescriptions.push(description);
      }
    }

    // Fetch replies and retweets
    const replies = await this.twitterClient.getReplies(tweet.id);
    const replyContext = replies
      .filter(reply => reply.username !== botTwitterUsername)
      .map(reply => `@${reply.username}: ${reply.text}`)
      .join('\n');

    console.log('****** imageDescriptions')
    console.log(imageDescriptions)

    let state = await this.agent.runtime.composeState(message, {
      twitterClient: this.twitterClient,
      twitterMessage: message,
      agentName: botTwitterUsername,
      bio: this.character.bio,
      name: botTwitterUsername,
      directions: this.directions,
      adjective: this.character.adjectives[Math.floor(Math.random() * this.character.adjectives.length)],
      tweetContext: `
Tweet Background:
${tweetBackground}

Original Tweet:
By @${tweet.username}
${tweet.text}${tweet.replies > 0 && `\nReplies to original tweet:\n${replyContext}`}\n${`Original tweet text: ${tweet.text}`}}
${tweet.urls.length > 0 ? `URLs: ${tweet.urls.join(', ')}\n` : ''}${imageDescriptions.length > 0 ? `\nImages in Tweet (Described): ${imageDescriptions.join(', ')}\n` : ''}
`
    });

    // Removed saveRequestMessage call as it's not defined in the class

    if (shouldIgnore) {
      console.log("shouldIgnore", shouldIgnore);
      return { content: "", action: "IGNORE" };
    }

    const nickname = settings.TWITTER_USERNAME;

    state = await this.agent.runtime.composeState(message, {
      twitterClient: this.twitterClient,
      twitterMessage: message,
      agentName: nickname,
    });

    if (!shouldRespond) {
      const shouldRespondContext = composeContext({
        state,
        template: shouldRespondTemplate,
      });

      const response = await this.agent.runtime.completion({
        context: shouldRespondContext,
        stop: [],
        model: this.model,
      });

      console.log("*** response from ", nickname, ":", response);

      if (response.toLowerCase().includes("respond")) {
        shouldRespond = true;
      } else if (response.toLowerCase().includes("ignore")) {
        shouldRespond = false;
      } else if (response.toLowerCase().includes("stop")) {
        shouldRespond = false;
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

    console.log("***** CONTEXT *****", context);

    if (this.agent.runtime.debugMode) {
      console.log(context, "Response Context");
    }

    let responseContent: Content | null = null;
    const { user_id, room_id } = message;

    for (let triesLeft = 3; triesLeft > 0; triesLeft--) {
      const response = await this.agent.runtime.completion({
        context,
        stop: [],
        temperature: this.temperature,
        model: this.model,
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

    // Removed saveResponseMessage call as it's not defined in the class
    this.agent.runtime.processActions(message, responseContent, state);

    const response = responseContent;

    if (response.content) {
      console.log(`Bot would respond to tweet ${tweet.id} with: ${response.content}`);
      try {
        await this.twitterClient.sendTweet(response.content, tweet.id);
        console.log(`Successfully responded to tweet ${tweet.id}`);
        const responseInfo = `Context:\n\n${context}\n\nSelected Tweet: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.content}`;
        const debugFileName = `tweets/tweet_generation_${tweet.id}.txt`;
        fs.writeFileSync(debugFileName, responseInfo);
      } catch (error) {
        console.error(`Error sending response tweet: ${error}`);
      }
    }
  }

  private async describeImage(imageUrl: string): Promise<string> {
    try {
      const description = await this.imageRecognitionService.recognizeImage(imageUrl);
      return description[0] || 'Unable to describe the image.';
    } catch (error) {
      console.error('Error describing image:', error);
      return 'Error occurred while describing the image.';
    }
  }

  private async ensureUserExists(userId: UUID, username: string): Promise<void> {
    // Implement user creation logic here
    // This might involve calling an API or updating a database
    console.log(`Ensuring user exists: ${username} (${userId})`);
    // For now, we'll assume the user exists
  }

  private async ensureRoomExists(roomId: UUID): Promise<void> {
    // Implement room creation logic here
    // This might involve calling an API or updating a database
    console.log(`Ensuring room exists: ${roomId}`);
    // For now, we'll assume the room exists
  }

  private async ensureParticipantInRoom(userId: UUID, roomId: UUID): Promise<void> {
    // Implement logic to add participant to room
    // This might involve calling an API or updating a database
    console.log(`Ensuring participant ${userId} is in room ${roomId}`);
    // For now, we'll assume the participant is added to the room
  }

  public async testImageRecognition(imageUrl: string): Promise<string> {
    try {
      const description = await this.describeImage(imageUrl);
      console.log('Image recognition test result:', description);
      return description;
    } catch (error) {
      console.error('Image recognition test failed:', error);
      throw error;
    }
  }
}
