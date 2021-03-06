const fs = require('fs');
const Path = require('path');
const promisify = require('es6-promisify').promisify;

const exists = function(path) {
    return new Promise((resolve, reject) => {
        fs.exists(path, function(v) {
            resolve(v);
        });
    });
};

const isDirectory = async function(source) {
    return (await promisify(fs.lstat)(source)).isDirectory();
};

const getDirectories = async function(source) {
    let children = await promisify(fs.readdir)(source);

    let res = [];

    for (let d of children) {
        d = Path.join(source, d);

        if (Path.basename(d) === '.git' && Path.basename(d) === '.hg') continue;
        if (!await isDirectory(d)) continue;

        res.push(d);
    }

    return res;
};

const getCFiles = async function(source) {
    return (await promisify(fs.readdir)(source))
        .map(name => Path.join(source, name))
        .filter(name => ['.c', '.cpp'].indexOf(Path.extname(name).toLowerCase()) > -1);
};

const getAllDirectories = async function(source) {
    let dirs = [ Path.resolve(source) + Path.sep ];
    for (let d of await getDirectories(source)) {
        dirs = dirs.concat(await getAllDirectories(d));
    }
    return dirs;
};

const getAllCFiles = async function(source) {
    let files = await getCFiles(source);
    for (let d of await getDirectories(source)) {
        files = files.concat(await getAllCFiles(d));
    }
    return files;
};

const ignoreAndFilter = async function(list, ignoreFile) {
    if (!await exists(ignoreFile)) {
        return list;
    }

    let parsed = (await promisify(fs.readFile)(ignoreFile, 'utf8')).split('\n').filter(f => !!f);

    parsed = parsed.map(l => new RegExp(l));

    list = list.filter(l => {
        return parsed.every(p => !p.test(l));
    });

    return list;
};

const defaultBuildFlags = [
    '-s', 'NO_EXIT_RUNTIME=1',
    '-s', 'ASSERTIONS=2',

    '-D__MBED__',
    '-DTARGET_SIMULATOR',
    '-DMBED_EXCLUSIVE_ACCESS=1U',
    '-DMBEDTLS_TEST_NULL_ENTROPY',
    '-DMBEDTLS_NO_DEFAULT_ENTROPY_SOURCES',
    '-DMBED_CONF_EVENTS_SHARED_EVENTSIZE=256',
    '-DMBEDTLS_USER_CONFIG_FILE=\"simulator_mbedtls_config.h\"',
    '-DMBED_CONF_PLATFORM_STDIO_CONVERT_NEWLINES=1',
    '-DMBED_CONF_MBED_TRACE_ENABLE=1',
    '-DFEATURE_COMMON_PAL=1', // this is annoying... it's used to feature detect tracing

    '-Wall',
];

const emterpretifyFlags = [
    '-s', 'EMTERPRETIFY=1',
    '-s', 'EMTERPRETIFY_ASYNC=1',
    '-g3'
];

const nonEmterpretifyFlags = [
    '-s', 'ASYNCIFY=1',
    '-g4'
];

// from https://stackoverflow.com/questions/31645738/how-to-create-full-path-with-nodes-fs-mkdirsync
const mkdirpSync = function(targetDir) {
    const sep = Path.sep;
    const initDir = Path.isAbsolute(targetDir) ? sep : '';
    const baseDir = '.';

    targetDir.split(sep).reduce((parentDir, childDir) => {
        const curDir = Path.resolve(baseDir, parentDir, childDir);
        if (!fs.existsSync(curDir)) {
            fs.mkdirSync(curDir);
        }
        return curDir;
    }, initDir);
}

const getMacrosFromMbedAppJson = async function(filename) {
    let mbedapp;

    if (await exists(filename)) {
        mbedapp = JSON.parse(await promisify(fs.readFile)(filename, 'utf-8'));
    }
    else {
        mbedapp = {};
    }

    let macros = [];

    let mbedapp_conf = mbedapp.config || {};
    for (let key of Object.keys(mbedapp_conf)) {
        let macroKey = 'MBED_CONF_APP_' + key.toUpperCase().replace(/(-|\.)/g, '_');

        if (!mbedapp_conf[key].value) {
            macros.push(macroKey);
            continue;
        }

        let value = mbedapp_conf[key].value.toString();

        value = value.replace(/"/g, '\\"');

        macros.push(macroKey + '=' + value);
    }

    macros = macros.concat(mbedapp.macros || []);

    // features_add is not handled correctly
    let target_over = Object.assign({}, (mbedapp.target_overrides || {})['*'], (mbedapp.target_overrides || {})['SIMULATOR']);
    for (let key of Object.keys(target_over)) {
        if (!target_over[key]) continue;

        let value = target_over[key].toString();
        if (key.indexOf('.') > -1) {
            key = 'MBED_CONF_' + key.toUpperCase().replace(/(-|\.)/g, '_');
        }
        else {
            key = 'MBED_CONF_APP_' + key.toUpperCase().replace(/(-|\.)/g, '_');
        }

        value = value.replace(/"/g, '\\"');

        let alreadyInMacros = macros.filter(m => {
            return m === key || m.indexOf(key + '=') === 0;
        });

        for (let m of alreadyInMacros) {
            macros.splice(macros.indexOf(m), 1);
        }

        macros.push(key + '=' + value);
    }

    return macros;
};

module.exports = {
    exists: exists,
    isDirectory: isDirectory,
    getDirectories: getDirectories,
    getCFiles: getCFiles,
    getAllDirectories: getAllDirectories,
    getAllCFiles: getAllCFiles,
    ignoreAndFilter: ignoreAndFilter,
    defaultBuildFlags: defaultBuildFlags,
    emterpretifyFlags: emterpretifyFlags,
    nonEmterpretifyFlags: nonEmterpretifyFlags,
    mkdirpSync: mkdirpSync,
    getMacrosFromMbedAppJson: getMacrosFromMbedAppJson
};
