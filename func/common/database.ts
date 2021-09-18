import {
  ColumnMetaData,
  ColumnValue,
  Connection,
  ParameterOptions,
  Request,
  TediousType,
  TYPES,
} from "tedious";

export type Parameter = {
  type: TediousType;
  value?: any;
  options?: ParameterOptions;
};

export type OutputParameter = {
  value: any;
  metadata: ColumnMetaData;
};

export type DatabaseResult = {
  rowCount: number;
  rows: Array<ColumnValue[]>;
  outputParameters: Record<string, OutputParameter>;
};

const resolveSimpleType = (value: any) => {
  switch (typeof value) {
    case "bigint":
      return TYPES.BigInt;
    case "boolean":
      return TYPES.Bit;
    case "number":
      return Number.isInteger(value) ? TYPES.Int : TYPES.Decimal;
    case "undefined":
      return TYPES.Null;
    case "string":
    default:
      return TYPES.NVarChar;
  }
};

export const connect = () =>
  new Promise<Connection>((resolve, reject) => {
    const connection = new Connection({
      server: process.env["SQLDB_SERVER"],
      authentication: {
        type: "default",
        options: {
          userName: process.env["SQLDB_USERNAME"],
          password: process.env["SQLDB_PASSWORD"],
        },
      },
      options: {
        database: process.env["SQLDB_DATABASE"],
        encrypt: true,
      },
    });

    connection.on("connect", (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(connection);
      }
    });

    connection.connect();
  });

export const execute = (
  sql: string,
  parameters: Record<
    string,
    bigint | boolean | string | number | undefined | null | Parameter
  > = {},
  outputParameters: Record<string, TediousType> = {}
) =>
  new Promise<DatabaseResult>((resolve, reject) => {
    connect().then((connection) => {
      const result: DatabaseResult = {
        rowCount: 0,
        rows: [],
        outputParameters: {},
      };

      const request = new Request(sql, (error, rowCount) => {
        if (error) {
          reject(error);
        } else {
          result.rowCount = rowCount;
          resolve(result);
        }
      });

      for (let name in parameters) {
        const param = parameters[name];
        const simpleType = (param as Parameter).type === undefined;
        const type = simpleType
          ? resolveSimpleType(param)
          : (param as Parameter).type;
        const value = simpleType ? param : (param as Parameter).type;
        const options = simpleType ? undefined : (param as Parameter).options;
        request.addParameter(name, type, value, options);
      }

      for (let name in outputParameters) {
        const type = outputParameters[name];
        request.addOutputParameter(name, type);
      }

      request.on("row", (columns) => {
        result.rows.push(columns);
      });

      request.on("returnValue", (parameterName, value, metadata) => {
        result.outputParameters[parameterName] = {
          value: value,
          metadata: metadata,
        };
      });

      connection.execSql(request);
    });
  });
