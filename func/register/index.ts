import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { Asserts, ValidationError } from "yup";
import * as yup from "yup";
import * as bcrypt from "bcrypt";
import { HttpResponseBuilder } from "../common/http";
import { execute } from "../common/database";

const RequestSchema = yup.object({
  body: yup.object({
    username: yup.string().required(),
    password: yup.string().required(),
  }),
});

interface RequestData extends Asserts<typeof RequestSchema> {}

const httpTrigger: AzureFunction = async (
  context: Context,
  req: HttpRequest
): Promise<void> => {
  try {
    const data: RequestData = RequestSchema.validateSync(req);
    const hash = bcrypt.hashSync(data.body.password, 10);

    const sql = `
      IF NOT EXISTS (SELECT 1 FROM [Stellar].[Users] WHERE [Username] = @username)
      INSERT INTO [Stellar].[Users] ([Username], [Password], [Balance])
      VALUES(@username, @password, @balance)`;

    const result = await execute(sql, {
      username: data.body.username,
      password: hash,
      balance: 0,
    });

    context.res =
      result.rowCount === 1
        ? HttpResponseBuilder.noContent().build()
        : HttpResponseBuilder.error(409);
  } catch (error) {
    if (error instanceof ValidationError) {
      const message = (error as ValidationError).message;
      context.res = HttpResponseBuilder.error(400, message).build();
    } else {
      context.log.error(error);
      context.res = HttpResponseBuilder.error(500).build();
    }
  }
};

export default httpTrigger;
