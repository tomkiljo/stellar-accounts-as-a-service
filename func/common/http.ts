export class HttpResponseBuilder {
  status: number;
  body?: string;
  headers: { [name:string] : string | undefined };

  constructor(status?: number) {
    this.status = status ?? 200;
    this.headers = {};
  }
  
  static ok(body:any) {
    return new HttpResponseBuilder(200).json(body);
  }

  static noContent() {
    return new HttpResponseBuilder(204);
  }

  static error(status: number, message?: string) {
    const builder = new HttpResponseBuilder(status);
    message && builder.json({message: message});
    return builder;
  }

  json(body: any): this {
    this.body = body;
    this.header("Content-Type", "application/json");
    return this;
  }

  header(name: string, value: string | undefined): this {
    this.headers[name] = value;
    return this;
  }

  build() {
    return {
      status: this.status,
      body: this.body,
      headers: this.headers,
    }
  }
}