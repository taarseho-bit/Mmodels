const fs = require('fs');
const files = [
  'D:\\softreg-源码\\.workbuddy\\memory\\MEMORY.md',
  'C:\\Users\\xh\\.workbuddy\\MEMORY.md',
];
const out = files.map((f) => f + ' => ' + fs.statSync(f).size + ' bytes').join('\n');
fs.writeFileSync('D:\\mathmodel-desktop\\.size.txt', out, 'utf8');
console.log('ok');
