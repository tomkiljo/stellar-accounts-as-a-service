import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { authenticate, AuthenticationError } from "../common/auth";
import { HttpResponseBuilder } from "../common/http";
import { muxedAccount } from "../common/stellar";
import BigDecimal from "js-big-decimal";

const httpTrigger: AzureFunction = async (
  context: Context,
  req: HttpRequest
): Promise<void> => {
  try {
    const userInfo = await authenticate(req);
    const userAccount = await muxedAccount(userInfo.userId);
    const balance = BigDecimal.divide(userInfo.balance, 10 ** 7, 7);

    context.res = HttpResponseBuilder.ok({
      address: userAccount.accountId(),
      balance: balance,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      context.res = HttpResponseBuilder.error(401).build();
    } else {
      context.log.error(error);
      context.res = HttpResponseBuilder.error(500).build();
    }
  }
};

export default httpTrigger;
