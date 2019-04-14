let requestify = require("requestify");
let fs = require("fs");
let Discord = require("discord.js");
let Queue = require("promise-queue");
let beatmapIdManager = require("./beatmapIdManager.js");

const mapRegex = /^https:\/\/osu.ppy.sh\/b\/[0-9]*$/;
const DATABASE_FILE = "database.json";
const USERS_FILE = "users.json";
const SETTINGS_FILE = "settings.json";
let database = {};
let beatmapIds = [];
let users = {};
let settings = {};
let done = 0;
let stop = false;
let queue;
let progressMessages = [];
let validKeys = [];
let curKeyIndex = 0;

let bot = new Discord.Client();

bot.on("message", message => {
    let content = message.content;
    let command = content.split(" ")[0];
    let remainder = content.split(" ")[1];
    let beatmapId = tryGetBeatmapFromMessage(message);

    if (beatmapId || command === "&linkchannel" || settings.linkedChannels.indexOf(message.channel.id) !== -1) {
        if (beatmapId) {
            getFirstPlace(beatmapId)
                .then(score => {
                    handleFirstPlaceResult(score, beatmapId);
                    saveFile(DATABASE_FILE, database);
                })
                .catch (error => {
                    message.channel.send("Error: " + error);
                });
        }
        switch (command) {
            case "&linkchannel":
                if (!isMod(message)) return;
                settings.linkedChannels.push(message.channel.id);
                message.channel.send("This channel can now be used by the bot.");
                saveFile(SETTINGS_FILE, settings);
                break;
            case "&unlinkchannel":
                if (!isMod(message)) return;
                let i = settings.linkedChannels.indexOf(message.channel.id);
                if (i !== -1) settings.linkedChannels.splice(i, 1);
                message.channel.send("This channel was unlinked.");
                saveFile(SETTINGS_FILE, settings);
                break;
            case "&snipe":
                let beatmapId = parseInt(remainder);
                if (Number.isInteger(beatmapId)) {
                    getFirstPlace(beatmapId)
                        .then(score => {
                            handleFirstPlaceResult(score, beatmapId, message.channel);
                            saveFile(DATABASE_FILE, database);
                        })
                        .catch (error => {
                            message.channel.send(error);
                        });
                }
                break;
            case "&rebuild":
                if (!isOwner(message)) return;
                resetSettings();
                createDatabase(beatmapIds)
                    .catch(error => {
                        console.warn(error);
                        message.channel.send("Error: " + error);
                    });
                break;
            case "&link":
                remainder = content.split(" ").slice(1, content.length).join(" ");
                getUser(remainder)
                    .then(user => {
                        users[message.author.id] = parseInt(user.userId);
                        message.channel.send("Linked " + ping(message.author.id) + " to osu! user " + user.username);
                        saveFile(USERS_FILE, users);
                    })
                    .catch(error => message.channel.send("Error: " + error));
                break;
            case "&continue":
                if (!isOwner(message)) return;
                createDatabase(beatmapIds, settings.curIndex)
                    .catch(error => message.channel.send("Error: " + error));
                break;
            case "&unlink":
                if (users[message.author.id]) {
                    delete users[message.author.id];
                    message.channel.send("You have been unlinked.");
                    saveFile(USERS_FILE, users);
                } else message.channel.send("No user found.");
                break;
            case "&rebuildfailed":
                if (!isOwner(message)) return;
                createDatabase(settings.failedIds.slice(0), 0, true)
                    .catch(error => message.channel.send("Error: " + error));
                break;
            case "&stop":
                if (!isOwner(message)) return;
                stop = true;
                break;
            case "&init":
                if (!isOwner(message)) return;
                init().then(() => message.channel.send("Done!")).catch(error => console.warn("Error: " + error));
                break;
            case "&progress":
                let progressMessage = getProgressMessage(message.channel.id);
                if (progressMessage) {
                    message.channel.send("https://discordapp.com/channels/" + progressMessage.guild.id + "/" + progressMessage.channel.id + "/" + progressMessage.id);
                } else message.channel.send("Currently not rebuilding.");
                break;
            case "&scores":
                remainder = content.split(" ").slice(1, content.length).join(" ");
                getUser(remainder).then(user => {
                    let list = "";
                    let amount = 0;
                    user.userId = parseInt(user.userId);
                    Object.keys(database).forEach(mapId => {
                        if (database[mapId] === user.userId) {
                            list += ("<a href='https://osu.ppy.sh/b/" + mapId + "'>" + mapId + "</a><br>");
                            amount++;
                        }
                    });
                    if (amount === 0) message.channel.send(user.username + " does not have any #1 scores.");
                    else message.channel.send("Here are all the maps " + user.username + " is first place on (" + amount + " maps):", new Discord.Attachment(Buffer.from(list), "Scores " + user.username + ".html"));
                }).catch(error => message.channel.send("Error: " + error));
                break;
            case "&count":
                remainder = content.split(" ").slice(1, content.length).join(" ");
                getUser(remainder).then(user => {
                    let amount = 0;
                    user.userId = parseInt(user.userId);
                    Object.keys(database).forEach(mapId => {
                        if (database[mapId] === user.userId) {
                            amount++;
                        }
                    });
                    if (amount === 0) message.channel.send(user.username + " does not have any #1 scores.");
                    else message.channel.send(user.username + " is first place on " + amount + " maps");
                }).catch(error => message.channel.send("Error: " + error));
                break;
            case "&top10":
                let message = '';
                let promises = rankings(database, 10)
                    .map(leader => getUser(leader[0]).then(user =>
                        [user,leader[1]]
                    ));
                Promise.all(promises)
                    .then(results => {
                        let rank = 0;
                        for ([user,count] of results) {
                            rank++;
                            message += rank + '. ' + user + ' - ' + count + '\n';
                        };
                        message.channel.send(message);
                    });
                break;

        }
    }
});

bot.on("ready", () => {
    console.warn("Bot running");
    if (settings.curIndex > 0) {
        createDatabase(beatmapIds, settings.curIndex)
            .catch(error => publishMessage("Error: " + error));
    }
});

init()
    .then(() => bot.login(process.env.BOT_TOKEN))
    .catch(errors => {
        errors.forEach(error => {
            console.warn(error);
        });
    });

function tryGetBeatmapFromMessage(message) {
    if (message.embeds.length === 0) return false;
    let embed = message.embeds[0];
    if (embed.message.embeds.length === 0) return false;
    embed = embed.message.embeds[0];
    let url = embed.url;
    if (!url) return false;
    if (url.indexOf("&") !== -1) url = url.substring(0, url.indexOf("&"));
    if (mapRegex.exec(url)) {
        let split = url.split("/");
        return parseInt(split[split.length-1]);
    } else return false;
}

function getProgressMessage(channelId) {
    for (let i = 0; i < progressMessages.length; i++) {
        if (progressMessages[i].channel.id === channelId) return progressMessages[i];
    }
    return null;
}

function resetSettings() {
    settings = {
        curIndex: 0,
        failedIds: [],
        linkedChannels: settings.linkedChannels
    }
}

function getNextTokenKey() {
    if (curKeyIndex > validKeys.length - 1) curKeyIndex = 1;
    else curKeyIndex++;
    return curKeyIndex;
}

function isMod(message) {
    if (message.member.hasPermission('KICK_MEMBERS')) return true;
    else {
        message.channel.send("Oi bruv you got a loicense for that command?");
        return false;
    }
}

function isOwner(message) {
    let owner = parseInt(message.author.id) === 68834122860077056;
    if (!owner) {
        message.channel.send("Oi bruv you got a loicense for that command?");
        return false;
    } else return true;
}

function init() {
    return new Promise((resolve, reject) => {
        queue = new Queue(1, Infinity);
        let promises = [];

        promises.push(beatmapIdManager.getBeatmapIds(process.env.API_KEY));
        promises.push(readFile(DATABASE_FILE));
        promises.push(readFile(USERS_FILE));
        promises.push(readFile(SETTINGS_FILE));
        promises.push(checkTokens());

        Promise.all(promises)
            .then(results => {
                beatmapIds = results[0] ? results[0] : [];
                database = results[1] ? results[1] : {};
                users = results[2] ? results[2] : {};
                settings = results[3] ? results[3] : resetSettings();
                queue = new Queue(validKeys.length, Infinity);
                resolve();
            })
            .catch(errors => {
                if (errors.length > 0) reject(errors);
            })
    });
}

function checkTokens() {
    let curIndex = 1;
    while(process.env["SESSION_KEY"+curIndex]) {
        curIndex++;
    }

    let done = 0;
    return new Promise(mainResolve => {
        for (let i = 1, p = Promise.resolve(); i < curIndex; i++) {
            p = p.then(() => new Promise(resolve => {
                    getFirstPlace(53, i)
                        .then(score => {
                            validKeys.push(process.env["SESSION_KEY" + i]);
                            done++;
                            resolve(score);

                            if (done === curIndex-1) mainResolve();
                        })
                        .catch(error => {
                            console.warn("SESSION_KEY" + i + " is invalid.");
                            done++;
                            resolve(error);

                            if (done === curIndex-1) mainResolve();
                        })
                }
            ));
        }
    });
}

function ping(id) {
    return "<@" + id + ">";
}

function getUser(username) {
    return new Promise((resolve, reject) => {
        let params = {
            k: process.env.API_KEY,
            m: 0,
            u: username
        };

        requestify.post("http://osu.ppy.sh/api/get_user", {}, {
            params: params
        })
            .then(response => {
                if (response.body === "[]") reject("No user found");
                else {
                    let user = response.getBody()[0];
                    resolve({userId: user.user_id, username: user.username});
                }
            })
            .catch(error => reject(error.getBody().error));
    });
}

function createDatabase(ids, startIndex, rebuildFailed) {
    return new Promise((mainResolve, mainReject) => {
        publishMessage("Building: 0.00% (0 of " + ids.slice(startIndex).length + ")")
            .then(messages => {
                progressMessages = messages;
                done = 0;
                stop = false;

                if (!startIndex) startIndex = 0;
                let idList = ids.slice(startIndex);
                if (idList.length === 0) finishCreatingDatabase(mainResolve);

                let originalArray = idList.slice(0, idList.length);
                let arrays = [], size = (idList.length / validKeys.length) + 1;
                while (idList.length > 0) arrays.push(idList.splice(0, size));

                let index = 0;
                for (let i = 0; i < arrays.length; i++) {
                    for (let j = 0, p = Promise.resolve(); j < arrays[i].length; j++) {
                        p = p.then(() => new Promise(resolve => {
                            let data = {
                                resolve: resolve,
                                mainResolve: mainResolve,
                                user: null,
                                beatmapId: null,
                                ids: arrays[i],
                                fullArray: originalArray,
                                index: index,
                                isMain: i === 0,
                                startIndex: startIndex,
                                rebuildFailed: rebuildFailed
                            };
                            settings.curIndex = Math.max(0, (index - arrays.length) + startIndex);
                            index++;
                            doRequest(data, stop);
                        })).catch(error => mainReject(error));
                    }
                }
            });
    });
}

function doRequest(data, stop) {
    let beatmapId = data.fullArray[data.index];
    data.beatmapId = beatmapId;

    if (stop) {
        if (data.isMain) finishCreatingDatabase(data.mainResolve);
        return;
    }

    let realIndex = data.index + 1 + data.startIndex;
    let realLength = data.rebuildFailed ? data.fullArray.length : beatmapIds.length;

    console.warn("Processing " + beatmapId + " | " + realIndex + " of " + realLength);
    let progress = ((realIndex / realLength) * 100).toFixed(2);
    progressMessages.forEach(progressMessage => {
        progressMessage.edit("Building: " + progress + "% (" + realIndex + " of " + realLength + ") | " + settings.failedIds.length + " failed");
    });

    let timeout = setTimeout(() => {
        console.warn("Error: Timed out");
        afterFirstPlaceRequest(data);
        if (!data.rebuildFailed) settings.failedIds.push(beatmapId);
    }, 11000);

    getFirstPlace(beatmapId)
        .then(score => {
            let failedIdIndex = settings.failedIds.indexOf(beatmapId);
            if (failedIdIndex !== -1) settings.failedIds.splice(failedIdIndex, 1);
            clearTimeout(timeout);
            data.score = score;
            afterFirstPlaceRequest(data);
        })
        .catch(error => {
            clearTimeout(timeout);
            if (error !== "No scores found.") {
                console.warn("Error: " + error);
                afterFirstPlaceRequest(data);
                if (!data.rebuildFailed) settings.failedIds.push(beatmapId);
            } else {
                let failedIdIndex = settings.failedIds.indexOf(beatmapId);
                if (failedIdIndex !== -1) settings.failedIds.splice(failedIdIndex, 1);
                data.score = {id: "", username: ""};
                afterFirstPlaceRequest(data);
            }
        });
}

function afterFirstPlaceRequest(data) {
    if (data.score) handleFirstPlaceResult(data.score, data.beatmapId);
    done++;

    if (done % 10 === 0) {
        saveFile(DATABASE_FILE, database);
        saveFile(SETTINGS_FILE, settings)
    }
    if (done === data.fullArray.length) {
        settings.curIndex = 0;
        finishCreatingDatabase(data.mainResolve);
    }
    else data.resolve();
}

function finishCreatingDatabase(mainResolve) {
    publishMessage("Done. Failed to process " + settings.failedIds.length + " maps.");
    progressMessages = [];
    saveFile(DATABASE_FILE, database);
    saveFile(SETTINGS_FILE, settings);
    mainResolve();
}

function handleFirstPlaceResult(score, beatmapId, channel) {
    let mapLink = "https://osu.ppy.sh/b/" + beatmapId;
    let scoreData = "Mode: " + score.mode;
    if (score.score) score.score = score.score.toLocaleString();
    if (score.id !== "") scoreData = scoreData + " | Score: " + score.score;

    if (score.id !== database[beatmapId]) {
        let localUser = getUserFromDb(database[beatmapId]);
        if (localUser) {
            bot.fetchUser(localUser).then(user => {
                user.send("You were sniped by " + score.username + "\n" + scoreData + "\n" + mapLink);
            }).catch(error => console.warn(error));
        }
        if (score.id !== "") {
            if (database[beatmapId]) {
                getUser(database[beatmapId])
                    .then(oldUser => {
                        publishMessage(oldUser.username + " was sniped by " + score.username + "\n" + scoreData + "\n" + mapLink);
                    })
                    .catch(error => publishMessage(error));
            } else {
                if (score.mode === "osu") {
                    publishMessage("New first place is " + score.username + "\n" + scoreData + "\n" + mapLink);
                }
            }
        } else if (channel) {
            channel.send("No scores found\n" + scoreData + "\n" + mapLink);
        }
    } else if (channel) channel.send("First place is " + score.username + "\n" + scoreData + "\n" + mapLink);

    database[beatmapId] = score.id;
}

function publishMessage(message) {
    let messages = [];
    let done = 0;

    return new Promise((mainResolve, mainReject) => {
        for (let i = 0, p = Promise.resolve(); i < settings.linkedChannels.length; i++) {
            p = p.then(() => new Promise(resolve => {
                let channel = bot.channels.get(settings.linkedChannels[i]);
                if (channel) channel.send(message)
                    .then(message => {
                        messages.push(message);
                        resolve();

                        done++;
                        if (done === settings.linkedChannels.length) mainResolve(messages);
                    })
                    .catch(() => {
                        done++;
                        if (done === settings.linkedChannels.length) mainResolve(messages);
                    });
            })).catch(error => mainReject(error));
        }
    });
}

function getUserFromDb(userId) {
    for (let key in users) {
        if (users.hasOwnProperty(key)) {
            if (users[key] === userId) return key;
        }
    }
    return false;
}

function getFirstPlace(beatmapId, keyIndex) {
    return new Promise((resolve, reject) => {
        queue.add(() => {
            return new Promise((resolve, reject) => {
                if (!keyIndex) keyIndex = getNextTokenKey();
                let params = {
                    type: "country"
                };

                let startTime = new Date();
                requestify.get("http://osu.ppy.sh/beatmaps/" + beatmapId + "/scores", {
                    params: params,
                    cookies: {
                        osu_session: process.env["SESSION_KEY" + keyIndex]
                    }
                })
                    .then(response => {
                        let elapsedTime = new Date() - startTime;
                        if (elapsedTime < 1500) {
                            setTimeout(() => {
                                let scores = JSON.parse(response.body).scores;
                                if (scores.length === 0) reject("No scores found.");
                                else {
                                    let score = scores[0];
                                    resolve({id: score.user.id, username: score.user.username, mode: score.mode, score: score.score});
                                }
                            }, 1500 - elapsedTime);
                        } else {
                            let scores = JSON.parse(response.body).scores;
                            if (scores.length === 0) reject("No scores found.");
                            else {
                                let score = scores[0];
                                resolve({id: score.user.id, username: score.user.username, mode: score.mode, score: score.score});
                            }
                        }
                    })
                    .catch(error => {
                        console.warn(error.body.substring(0, 100));
                        let elapsedTime = new Date() - startTime;
                        if (elapsedTime < 1500) {
                            setTimeout(() => {
                                reject("Error: failed to retrieve first place.");
                            }, 1500 - elapsedTime);
                        } else {
                            reject("Error: failed to retrieve first place.");
                        }
                    });
            });
        })
            .then(user => resolve(user))
            .catch(error => reject(error));
    });
}

function readFile(file) {
    return new Promise(resolve => {
        fs.readFile(file, "utf-8", (err, data) => {
            let result = {};
            if (err) console.warn("Error: " + err);
            else result = JSON.parse(data);
            resolve(result);
        });
    });
}

function saveFile(file, content) {
    fs.writeFile(file, JSON.stringify(content), err => {
        if(err) return console.warn("Error: " + err);
        console.warn(file + " was saved!");
    });
}

function rankings(database, size) {
    let ranking = {};
    for (const user of Object.values(database)) {
        if (ranking[user]) {
            ranking[user]++;
        } else {
            ranking[user] = 1;
        }
    }
    delete ranking[''];
    let leaders = Object.entries(ranking);
    leaders.sort((a, b) => b[1] - a[1]);
    return leaders.slice(0, size);
}

