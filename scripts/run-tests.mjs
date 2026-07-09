// Root test runner. The suite's explicit file list outgrew the Windows cmd.exe
// command-line limit (~8k chars) inside the npm "test" script, so this spawns
// node directly (CreateProcess limit ~32k) with the manifest from
// scripts/test-files.mjs. Behavior is otherwise identical to the old
// `node --import tsx --test <files>` invocation.
import { spawn } from "node:child_process";
import { TEST_FILES } from "./test-files.mjs";

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...TEST_FILES], {
    stdio: "inherit",
    cwd: new URL("..", import.meta.url),
});
child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
});
