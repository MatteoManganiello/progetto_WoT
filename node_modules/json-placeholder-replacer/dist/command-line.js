"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commandLineExecution = void 0;
const library_1 = require("./library");
const commandLineExecution = (fs, args, stdinBuffer) => {
    //Prevents prototype-pollution
    Object.freeze(Object.prototype);
    process.exitCode = args.length;
    if (args.length < 3) {
        showUsage();
    }
    else {
        let annotated = readFile(args[2], fs);
        const variableMaps = args.filter((_value, index) => index > 2);
        if (stdinBuffer) {
            variableMaps.unshift(args[2]);
            annotated = stdinBuffer.toString();
        }
        const replacer = new library_1.JsonPlaceholderReplacer();
        variableMaps.forEach((filename) => replacer.addVariableMap(readFile(filename, fs)));
        const replacedValue = replacer.replace(JSON.parse(annotated));
        console.log(JSON.stringify(replacedValue));
        process.exitCode = 0;
        return replacedValue;
    }
};
exports.commandLineExecution = commandLineExecution;
const showUsage = () => {
    console.error(`Wrong command line usage\n`);
    console.log(`Usage:`);
    console.log(`   jpr replaceable_filename variable_maps...`);
    console.log(`   jpr variable_maps... < replaceable_filename`);
    console.log(`   cat replaceable_filename | jpr variable_maps...`);
};
const readFile = (filename, fs) => {
    if (filename.indexOf("\0") !== -1) {
        throw Error(`Access denied! '${filename}' is not sanitized`);
    }
    if (!fs.existsSync(filename)) {
        throw Error(`Access denied! no such file: '${filename}'`);
    }
    return fs.readFileSync(filename).toString();
};
