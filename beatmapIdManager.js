module.exports = {
    getBeatmapIds: (key) => {
        return new Promise((resolve, reject) => {
            apiKey = key;
            getLatestDate()
            .then(date => {
                loopRequests(date);
                resolveEmitter.on("done", () => {
                    resolve(beatmapIds);
                });
                resolveEmitter.on("error", error => reject(error));
            });
        });
    }
};

let requestify = require("requestify");
let fs = require("fs");
let EventEmitter = require("events");

const BEATMAP_ID_FILE = "beatmapids.json";
let apiKey;
let beatmapIds = [];

class ResolveEmitter extends EventEmitter {};
const resolveEmitter = new ResolveEmitter();

function getLatestDate() {
    return new Promise(resolve => {
        readIds()
        .then(() => {
            if (beatmapIds.length > 0) {
                sendRequest(null, beatmapIds[beatmapIds.length-1])
                    .then(date => {
                        resolve(date);
                    });
            } else resolve(toMysqlFormat(new Date("2007")));
        });
    });
}

function loopRequests(date) {
    sendRequest(date)
    .then(newDate => loopRequests(newDate))
    .catch(error => {
        console.log(error);
        if (error === "No more beatmaps") {
            saveIds();
            resolveEmitter.emit("done");
        }
        else resolveEmitter.emit("error", error);
    });
}

function sendRequest(date, b) {
    return new Promise((resolve, reject) => {
        let params = {
            k: apiKey
        };
        if (b) {params.b = b; console.log("Getting date from map " + b);}
        if (date) {params.since = date; console.log("Current date " + date);}

        requestify.post("http://osu.ppy.sh/api/get_beatmaps", {}, {
            params: params
        })
        .then(response => {
            let beatmapToResolve;

            if (date) {
                let beatmaps = response.getBody();
                if (beatmaps.length === 0) reject("No more beatmaps");
                beatmaps.forEach(beatmap => {
                    let beatmapId = parseInt(beatmap.beatmap_id);
                    if (beatmapIds.indexOf(beatmapId) === -1) {
                        beatmapIds.push(beatmapId);
                    }
                });
                beatmapToResolve = beatmaps[beatmaps.length-1];
            } else if (b) beatmapToResolve = response.getBody()[0];
            else reject("No date found");

            resolve(toMysqlFormat(new Date(beatmapToResolve.approved_date + "Z")));
        })
        .catch(error => console.error(error.getBody().error));
    });
}

function readIds() {
    return new Promise(resolve => {
        fs.readFile(BEATMAP_ID_FILE, "utf-8", (err, data) => {
            if (err) console.log(err);
            else beatmapIds = JSON.parse(data);
            resolve();
        });
    });
}

function saveIds() {
    fs.writeFile(BEATMAP_ID_FILE, JSON.stringify(beatmapIds), err => {
        if(err) return console.log(err);
        console.log(BEATMAP_ID_FILE + " was saved!");
    }); 
}

function twoDigits(d) {
    if(0 <= d && d < 10) return "0" + d.toString();
    if(-10 < d && d < 0) return "-0" + (-1*d).toString();
    return d.toString();
}

function toMysqlFormat(date) {
    return date.getUTCFullYear() + "-" + twoDigits(1 + date.getUTCMonth()) + "-" + twoDigits(date.getUTCDate()) + " " + twoDigits(date.getUTCHours()) + ":" + twoDigits(date.getUTCMinutes()) + ":" + twoDigits(date.getUTCSeconds());
};
