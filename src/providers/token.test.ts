import { TokenProvider } from "./token";
import NodeCache from "node-cache";

// Mock the dependencies
jest.mock("cross-fetch");
jest.mock("fs");
jest.mock("node-cache");

describe("TokenProvider Tests", () => {
  //   let connection: Connection;
  let tokenProvider: TokenProvider;

  beforeEach(() => {
    // Initialize the connection and token provider before each test
    //  connection = new Connection("https://api.mainnet-beta.solana.com");
    tokenProvider = new TokenProvider(
      "2weMjPLLybRMMva1fM3U31goWWrCpF59CHWNhnCJ9Vyh"
    );
  });

  test("should fetch token security data", async () => {
    // Mock the response for the fetchTokenSecurity call
    const mockFetchResponse = {
      success: true,
      data: {
        ownerBalance: "100",
        creatorBalance: "50",
        ownerPercentage: 10,
        creatorPercentage: 5,
        top10HolderBalance: "200",
        top10HolderPercent: 20,
      },
    };

    // Mock fetchWithRetry function
    const fetchSpy = jest
      .spyOn(tokenProvider as any, "fetchWithRetry")
      .mockResolvedValue(mockFetchResponse);

    //  Run the fetchTokenSecurity method
    //  const securityData = await tokenProvider.fetchTokenSecurity();

    // Check if the data returned is correct
    //  expect(securityData).toEqual({
    //    ownerBalance: "100",
    //    creatorBalance: "50",
    //    ownerPercentage: 10,
    //    creatorPercentage: 5,
    //    top10HolderBalance: "200",
    //    top10HolderPercent: 20,
    //  });
    //console.log the securityData
    //  console.log({ securityData });

    //  const holderList = await tokenProvider.fetchHolderList();

    //  console.log({ holderList });

    //  const tradeData = await tokenProvider.fetchTokenTradeData();
    //  console.log({ tradeData });

    //  const dexScreenerData = await tokenProvider.fetchDexScreenerData();
    //  console.log({ dexScreenerData });

    const tokenReport = await tokenProvider.getFormattedTokenReport();
    console.log({ tokenReport });

    // Ensure the mock was called
    expect(fetchSpy).toHaveBeenCalled();
  });
});
