const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
    const appDir = path.join(context.appOutDir, 'resources', 'app.asar.unpacked');
    const srcNode = path.join(appDir, 'node_modules', '@lancedb', 'lancedb-linux-x64-gnu', 'lancedb.linux-x64-gnu.node');
    const destNode = path.join(appDir, 'node_modules', '@lancedb', 'lancedb', 'dist', 'lancedb.linux-x64-gnu.node');
    
    if (fs.existsSync(srcNode)) {
        if (!fs.existsSync(path.dirname(destNode))) {
            fs.mkdirSync(path.dirname(destNode), { recursive: true });
        }
        fs.copyFileSync(srcNode, destNode);
        console.log(`Copied ${srcNode} to ${destNode}`);
    }
};
