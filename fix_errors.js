const fs = require('fs');
let file, p, content;

file = 'src/events/tryon.events.ts';
p = require('path').join('c:/Users/devrm/Documents/GitHub/mirror/mirror-api', file);
content = fs.readFileSync(p, 'utf8').replace(/catch\s*\{/g, 'catch (err) {');
fs.writeFileSync(p, content);

file = 'src/platforms/chatWonder/chatWonder.service.ts';
p = require('path').join('c:/Users/devrm/Documents/GitHub/mirror/mirror-api', file);
content = fs.readFileSync(p, 'utf8').replace(/catch\s*\{/g, 'catch (error) {');
fs.writeFileSync(p, content);

file = 'src/services/remote/auth.service.ts';
p = require('path').join('c:/Users/devrm/Documents/GitHub/mirror/mirror-api', file);
content = fs.readFileSync(p, 'utf8').replace(/catch\s*\{/g, 'catch (error) {');
fs.writeFileSync(p, content);

file = 'src/services/shared/voice.service.ts';
p = require('path').join('c:/Users/devrm/Documents/GitHub/mirror/mirror-api', file);
content = fs.readFileSync(p, 'utf8').replace(/catch\s*\{/g, 'catch (e) {');
fs.writeFileSync(p, content);

file = 'src/utils/parse-chatWonder-response.util.ts';
p = require('path').join('c:/Users/devrm/Documents/GitHub/mirror/mirror-api', file);
content = fs.readFileSync(p, 'utf8').replace(/catch\s*\{/g, 'catch (error) {');
fs.writeFileSync(p, content);

file = 'src/utils/chat-wonder-outfits.util.ts';
p = require('path').join('c:/Users/devrm/Documents/GitHub/mirror/mirror-api', file);
content = fs.readFileSync(p, 'utf8').replace('layerLevel,\n            })),\n          },', 'layerLevel,\n            })) as any,\n          },');
fs.writeFileSync(p, content);

console.log('Done');
