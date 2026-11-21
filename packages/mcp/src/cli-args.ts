export type ParsedCliArgs = {
  help: boolean;
  http: boolean;
  local: boolean;
  httpPort: number;
  smtpPort: number | undefined;
  disableSmtp: boolean;
  disableHttp: boolean;
};

export function parseArgs(argv: string[]): ParsedCliArgs {
  const help = argv.includes("--help") || argv.includes("-h");
  const local = argv.includes("--local");
  const disableSmtp = argv.includes("--no-smtp");
  const disableHttp = argv.includes("--no-http");

  const httpIdx = argv.findIndex((a) => a === "--http");
  const http = httpIdx >= 0;
  let httpPort = 8787;
  if (http && argv[httpIdx + 1] && !argv[httpIdx + 1]!.startsWith("-")) {
    httpPort = Number.parseInt(argv[httpIdx + 1]!, 10);
    if (!Number.isFinite(httpPort) || httpPort <= 0) {
      throw new Error(`Invalid --http port: ${argv[httpIdx + 1]}`);
    }
  }

  const smtpIdx = argv.findIndex((a) => a === "--smtp-port");
  let smtpPort: number | undefined;
  if (smtpIdx >= 0) {
    const raw = argv[smtpIdx + 1];
    if (!raw || raw.startsWith("-")) {
      throw new Error("--smtp-port requires a port number");
    }
    smtpPort = Number.parseInt(raw, 10);
    if (!Number.isFinite(smtpPort) || smtpPort < 0) {
      throw new Error(`Invalid --smtp-port: ${raw}`);
    }
  }

  return {
    help,
    http,
    local,
    httpPort,
    smtpPort,
    disableSmtp,
    disableHttp,
  };
}
