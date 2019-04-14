const Discord = require('discord.io');
const itemlist = require('./itemlist.json');
const fs = require('fs');

// Initialize Discord Bot
let bot = new Discord.Client({
    token: process.env.TOKEN,
    autorun: true
});

bot.on('message', function (user, userID, channelID, message, evt) {
    let command = message.substr(0,message.indexOf(' '));
    let remainder = message.substr(message.indexOf(' ')+1);

    if(command === '!additem') {
        if(checkItem(message)) {
            bot.sendMessage({
                to: channelID,
                message: 'Item already exists.'
            });
            console.log('Item already exists.');
        } else {
            itemlist.stuff.push(remainder);
            fs.writeFile('itemlist.json', JSON.stringify(itemlist), 'utf8', function () {
                bot.sendMessage({
                    to: channelID,
                    message: 'Item added.'
                });
            });
        }
    } else if(command === '!removeitem') {
        let index = checkItem(message);

        if(index) {
            itemlist.stuff.splice(index, 1);
            fs.writeFile('itemlist.json', JSON.stringify(itemlist), 'utf8', function () {
                bot.sendMessage({
                    to: channelID,
                    message: 'Item removed.'
                });
            });
        } else {
            bot.sendMessage({
                to: channelID,
                message: 'Item does not exist.'
            });
        }
    } else if(message === '!analyze') {
        bot.getMessages( {channelID: channelID, limit: 100}, function (error, messages) {
            if(error) {
                bot.sendMessage({
                    to: channelID,
                    message: 'An error has occurred: ' + error
                });
            } else {
                bot.sendMessage({
                    to: channelID,
                    message: 'Analyzing...'
                }, function () {
                    let amount = 0;

                    let x = 0;
                    let loopArray = function (arr) {
                        checkGenesisMessage({d:arr[x]}, channelID, false, function (result) {
                            x++;

                            if(result) {
                                amount++;
                            }

                            if(x < arr.length) {
                                loopArray(arr);
                            } else {
                                bot.sendMessage({
                                    to: channelID,
                                    message: 'Done, deleted ' + amount + ' messages.'
                                });
                            }
                        });
                    };

                    loopArray(messages);
                });
            }
        });
    } else {
        checkGenesisMessage(evt, channelID, true, function () {});
    }
});

function checkGenesisMessage(evt, channelID, ping, callback) {
    if(evt.d.author.username === 'Genesis' && evt.d.embeds.length > 0 && evt.d.embeds[0].title) {
        let item = evt.d.embeds[0].title.toLowerCase();
        let delet = false;

        if(item.indexOf(' vs ') !== -1) {
            let substring = item.substring(5, item.length - 6);
            let items = substring.split(' vs ');

            if(checkItem(items[0]) && checkItem(items[1])) {
                bot.deleteMessage({
                    channelID: channelID,
                    messageID: evt.d.id
                }, function () {
                    delet = true;

                    shouldPing(ping, delet, item, channelID, function () {
                        callback(delet);
                    });
                });
            } else {
                callback(delet);
            }
        } else {
            delet = checkItem(item);
            if(delet) {
                bot.deleteMessage({
                    channelID: channelID,
                    messageID: evt.d.id
                }, function () {
                    shouldPing(ping, delet, item, channelID, function () {
                        callback(delet);
                    });
                });
            } else {
                callback(delet);
            }
        }
    } else {
        callback(null);
    }
}

function shouldPing(ping, delet, item, channelID, callback){
    console.log(ping, delet);
    if(ping && !delet) {
        let shouldping = true;

        itemlist.dontping.forEach(function (dontping) {
            if(item.indexOf(dontping) !== -1) {
                shouldping = false;
            }
        });

        if(shouldping) {
            bot.sendMessage({
                to: channelID,
                message: '<@68834122860077056>'
            }, callback(true));
        } else {
            callback(false);
        }
    } else {
        callback(false);
    }
}

function checkItem(item) {
    let result = null;

    itemlist.stuff.forEach(function (thing, index) {
        if(item.indexOf(thing) !== -1) {
            result = index;
        }
    });

    return result;
}