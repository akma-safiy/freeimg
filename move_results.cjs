const fs = require('fs');
const filePath = 'c:/Users/muhdk/.gemini/antigravity/scratch/ai-outfit-generator/src/App.jsx';

const content = fs.readFileSync(filePath, 'utf-8');
let lines = content.split('\n');

const startIdx = 1501; // Line 1502
const endIdx = 1845;   // Line 1846
const insertIdx = 1251; // Line 1252

const blockToMove = lines.slice(startIdx, endIdx + 1);
lines.splice(startIdx, endIdx - startIdx + 1);
lines.splice(insertIdx, 0, ...blockToMove);

fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
console.log('Moved lines successfully!');
