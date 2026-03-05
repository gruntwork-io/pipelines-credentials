const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function extractScript() {
  const actionPath = path.resolve(__dirname, '..', '..', 'action.yml');
  const content = fs.readFileSync(actionPath, 'utf8');
  const parsed = yaml.load(content);
  return parsed.runs.steps[0].with.script;
}

module.exports = { extractScript };
