import fs from 'node:fs/promises';
import { sectorWorldPrompt } from './sector-world-prompt.mjs';
const out = 'output/connected-world';
const tasks = JSON.parse(await fs.readFile(out + '/tasks.json', 'utf8'));
const layouts = JSON.parse(await fs.readFile(out + '/layouts.json', 'utf8'));
const prompts = {};
for (const task of tasks) {
    task.prompt = sectorWorldPrompt(task, layouts[task.artKey]);
    prompts[task.id] = task.prompt;
    await fs.writeFile(`${out}/s${task.artKey}-prompt.txt`, task.prompt);
}
await fs.writeFile(out + '/tasks.json', JSON.stringify(tasks, null, 2));
await fs.writeFile(out + '/prompts.json', JSON.stringify(prompts, null, 2));
console.log('Refreshed 65 prompts with actual landmark membership and reciprocal road materials.');
