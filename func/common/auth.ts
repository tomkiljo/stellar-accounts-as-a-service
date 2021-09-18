import { HttpRequest } from "@azure/functions";
import { TYPES } from "tedious";
import * as bcrypt from "bcrypt";
import { execute } from "./database";

export class AuthenticationError extends Error {}

export interface UserInfo {
  userId: number;
  balance: BigInt;
}

export const authenticate = async (req: HttpRequest): Promise<UserInfo> => {
  let userInfo: UserInfo | undefined;
  const auth = req.headers["authorization"];

  if (auth && auth.startsWith("Bearer ")) {
    const query = `
        SELECT TOP 1 @userId = users.[UserID], @balance = users.[Balance]
        FROM [Stellar].[ApiKeys] AS apiKeys
        LEFT JOIN [Stellar].[Users] AS users
          ON users.[UserID] = apiKeys.[UserID] 
        WHERE apiKeys.[ApiKey] = @apiKey`;

    const apiKey = auth.slice(7);
    const salt = process.env["API_KEY_SALT"]!;
    const hash = bcrypt.hashSync(apiKey, salt);

    const result = await execute(
      query,
      {
        apiKey: hash,
      },
      {
        userId: TYPES.Int,
        balance: TYPES.BigInt,
      }
    );

    userInfo =
      result.rowCount === 1
        ? {
            userId: result.outputParameters.userId.value,
            balance: BigInt(result.outputParameters.balance.value),
          }
        : undefined;
  }

  if (!userInfo) {
    throw new AuthenticationError();
  }
  return userInfo;
};
