import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { Asserts, ValidationError } from "yup";
import * as yup from "yup";
import * as bcrypt from "bcrypt";
import { HttpResponseBuilder } from "../common/http";
import { execute } from "../common/database";
import { TYPES } from "tedious";
import { v4 } from "uuid";

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

    const userQuery = `
      SELECT TOP 1 @userId = [UserID], @password = [Password]
      FROM [Stellar].[Users]
      WHERE [Username] = @username`;

    const tokenQuery = `
      MERGE [Stellar].[ApiKeys] AS [target]
      USING (SELECT @userId UserID, @apikey ApiKey) AS [source]
        ON [source].[UserID] = [target].[UserID]
      WHEN MATCHED THEN UPDATE
        SET [ApiKey] = [source].[ApiKey]
      WHEN NOT MATCHED THEN
        INSERT (UserID, ApiKey) 
        VALUES (@UserID, @ApiKey);
    `;

    // query user id and hashed password
    const result = await execute(
      userQuery,
      {
        username: data.body.username,
      },
      {
        userId: TYPES.Int,
        password: TYPES.NVarChar,
      }
    ).then((result) => {
      // validate given password
      const authenticated =
        result.rowCount === 1 &&
        bcrypt.compareSync(
          data.body.password,
          result.outputParameters.password.value
        );
      return authenticated ? result : undefined;
    });

    if (result) {
      // create and store new api key in db
      const apiKey = v4();
      const salt = process.env["API_KEY_SALT"]!;
      const hash = bcrypt.hashSync(apiKey, salt);
      bcrypt.genSaltSync();
      await execute(tokenQuery, {
        userId: result.outputParameters.userId.value,
        apiKey: hash,
      });
      context.res = HttpResponseBuilder.ok({
        apiKey: apiKey,
      });
    } else {
      context.res = HttpResponseBuilder.error(401);
    }
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
