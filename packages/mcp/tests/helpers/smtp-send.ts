import { connect, type Socket } from "node:net";

class LineReader {
  private buffer = "";
  private readonly queue: string[] = [];
  private waiters: Array<(line: string) => void> = [];

  private closed = false;

  constructor(private readonly socket: Socket) {
    socket.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).replace(/\r$/, "");
        this.buffer = this.buffer.slice(idx + 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter(line);
        else this.queue.push(line);
      }
    });
    const onClose = () => {
      this.closed = true;
      while (this.waiters.length) {
        const waiter = this.waiters.shift();
        waiter?.("421 connection closed");
      }
    };
    socket.on("close", onClose);
    socket.on("end", onClose);
  }

  readLine(): Promise<string> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift()!);
    if (this.closed) return Promise.resolve("421 connection closed");
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async readReply(): Promise<string> {
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      lines.push(line);
      if (/^\d{3} /.test(line)) break;
    }
    return lines.join("\n");
  }
}

/**
 * Minimal SMTP client for tests — sends one message to a catch-all server.
 */
export async function smtpSend(options: {
  host: string;
  port: number;
  from: string;
  to: string[];
  raw: string;
}): Promise<void> {
  const socket = connect({ host: options.host, port: options.port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  const reader = new LineReader(socket);

  const expectOk = async (cmd?: string) => {
    if (cmd !== undefined) socket.write(`${cmd}\r\n`);
    const reply = await reader.readReply();
    const code = Number.parseInt(reply.slice(0, 3), 10);
    if (code >= 400) {
      throw new Error(`SMTP error for ${cmd ?? "(banner)"}: ${reply}`);
    }
    return reply;
  };

  await expectOk();
  await expectOk("EHLO envlo.test");
  await expectOk(`MAIL FROM:<${options.from}>`);
  for (const to of options.to) {
    await expectOk(`RCPT TO:<${to}>`);
  }
  await expectOk("DATA");

  const normalized = options.raw
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "\r\n")
    .replace(/^\./gm, "..");
  socket.write(`${normalized}\r\n.\r\n`);
  await expectOk();
  try {
    await expectOk("QUIT");
  } catch {
    // some servers close immediately
  }
  socket.end();
}
