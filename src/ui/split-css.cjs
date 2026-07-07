const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'styles.css');
const content = fs.readFileSync(srcPath, 'utf8');
const lines = content.split(/\r?\n/);

const getLines = (start, end) => lines.slice(start - 1, end).join('\n');

const globalCss = getLines(1, 91);
const floatControlCss = getLines(92, 188) + '\n\n@media (max-width: 768px) {\n' + getLines(844, 877) + '\n}\n';
const settingsPanelCss = getLines(189, 456) + '\n\n@media (max-width: 768px) {\n' + getLines(907, 994) + '\n}\n';
const overlayCss = getLines(457, 822) + '\n\n@media (max-width: 768px) {\n' + getLines(824, 843) + '\n' + getLines(878, 906) + '\n}\n\n' + getLines(997, 1057);

fs.writeFileSync(path.join(__dirname, 'global.css'), globalCss);
fs.writeFileSync(path.join(__dirname, 'float-control.css'), floatControlCss);
fs.writeFileSync(path.join(__dirname, 'settings-panel.css'), settingsPanelCss);
fs.writeFileSync(path.join(__dirname, 'single-page', 'overlay.css'), overlayCss);

fs.unlinkSync(srcPath);
console.log('Successfully split styles.css');
