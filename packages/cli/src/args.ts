export type ParsedArgs = {
  prompt?: string;
  model?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";
  maxTurns?: number;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  continue?: boolean;
  resume?: string;
  cwd?: string;
  additionalDirectories?: string[];
  port?: number;
  debug?: boolean;
  noOpen?: boolean;
  dev?: boolean;
  version?: boolean;
  help?: boolean;
};

const PERMISSION_MODES = new Set(["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"]);

function nextArg(argv: string[], i: number, flag: string): string {
  if (i + 1 >= argv.length) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(1);
  }
  return argv[i + 1]!;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  const positional: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i]!;

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

      case "-m":
      case "--model":
        result.model = nextArg(argv, i, arg);
        i++;
        break;

      case "--permission-mode": {
        const mode = nextArg(argv, i, arg);
        if (!PERMISSION_MODES.has(mode)) {
          console.error(`Error: invalid permission mode "${mode}". Must be one of: ${[...PERMISSION_MODES].join(", ")}`);
          process.exit(1);
        }
        result.permissionMode = mode as ParsedArgs["permissionMode"];
        i++;
        break;
      }

      case "--max-turns":
        result.maxTurns = parseInt(nextArg(argv, i, arg), 10);
        i++;
        break;

      case "--max-budget-usd":
        result.maxBudgetUsd = parseFloat(nextArg(argv, i, arg));
        i++;
        break;

      case "--system-prompt":
        result.systemPrompt = nextArg(argv, i, arg);
        i++;
        break;

      case "--allowed-tools":
        result.allowedTools = nextArg(argv, i, arg).split(",").map(s => s.trim());
        i++;
        break;

      case "--disallowed-tools":
        result.disallowedTools = nextArg(argv, i, arg).split(",").map(s => s.trim());
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

      case "--add-dir":
        if (!result.additionalDirectories) result.additionalDirectories = [];
        result.additionalDirectories.push(nextArg(argv, i, arg));
        i++;
        break;

      case "--port":
        result.port = parseInt(nextArg(argv, i, arg), 10);
        i++;
        break;

      case "--debug":
        result.debug = true;
        break;

      case "--no-open":
        result.noOpen = true;
        break;

      case "--dev":
        result.dev = true;
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

  return result;
}
