export type FileSystem = {
    readFileSync: (filename: string) => {
        toString: () => string;
    };
    existsSync: (filename: string) => boolean;
};
export declare const commandLineExecution: (fs: FileSystem, args: string[], stdinBuffer?: Buffer) => object | undefined;
