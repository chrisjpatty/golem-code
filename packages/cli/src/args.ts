export type ParsedArgs = {
  prompt?: string;
  continue?: boolean;
  resume?: string;
  cwd?: string;
  port?: number;
  noOpen?: boolean;
  dev?: boolean;
  browser?: boolean;
  golemDebug?: boolean;
  version?: boolean;
  help?: boolean;
  update?: boolean;
  /** Everything after -- is forwarded to Claude as-is */
  passthroughArgs?: string[];
};

function nextArg(argv: string[], i: number, flag: string): string {
  if (i + 1 >= argv.length) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(1);
  }
  return argv[i + 1]!;
}

function parseIntArg(argv: string[], i: number, flag: string): number {
  const value = parseInt(nextArg(argv, i, flag), 10);
  if (isNaN(value)) {
    console.error(`Error: ${flag} requires an integer value`);
    process.exit(1);
  }
  return value;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  const positional: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i]!;

    // Everything after -- is passthrough to Claude
    if (arg === "--") {
      result.passthroughArgs = argv.slice(i + 1);
      break;
    }

    switch (arg) {
      case "-h":
      case "--help":
        result.help = true;
        break;

      case "-v":
      case "--version":
        result.version = true;
        break;

      case "-p":
      case "--prompt":
        result.prompt = nextArg(argv, i, arg);
        i++;
        break;

      case "-c":
      case "--continue":
        result.continue = true;
        break;

      case "-r":
      case "--resume":
        result.resume = nextArg(argv, i, arg);
        i++;
        break;

      case "--cwd":
        result.cwd = nextArg(argv, i, arg);
        i++;
        break;

      case "--port":
        result.port = parseIntArg(argv, i, arg);
        i++;
        break;

      case "--no-open":
        result.noOpen = true;
        break;

      case "--dev":
        result.dev = true;
        break;

      case "--browser":
        result.browser = true;
        break;

      case "--golem-debug":
        result.golemDebug = true;
        break;

      case "update":
      case "--update":
        result.update = true;
        break;

      default:
        if (arg.startsWith("-")) {
          console.error(`Error: unknown option "${arg}". Use --help for usage.`);
          process.exit(1);
        }
        positional.push(arg);
        break;
    }

    i++;
  }

  // First positional argument is the prompt (like Claude Code)
  if (positional.length > 0 && !result.prompt) {
    result.prompt = positional.join(" ");
  }

  if (result.continue && result.resume) {
    console.error("Error: --continue and --resume cannot be used together");
    process.exit(1);
  }

  return result;
}
