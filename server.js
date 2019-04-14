// server.js
// where your node app starts
// init project
const Gifsicle = require('gifsicle-stream');
const request = require('request');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const base64 = require('base-64');
const toStream = require('buffer-to-stream');
const winston = require('winston');
const gifmodify = require('./gifmodify.js');
const githelper = require('./githelper.js');
const app = express();
const botActive = true;
let jsonParser = bodyParser.json({
  limit: '50mb'
});
const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console()
  ]
});

if (botActive) require('./yentisbot.js');

// we've started you off with Express, 
// but feel free to use whatever libs or frameworks you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
// Add headers
app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', 'https://discordapp.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  next();
});
app.use(express.static('public'));
app.set('view engine', 'pug');

app.get('/test', (req, res) => {
  res.render('test');
});

// http://expressjs.com/en/starter/basic-routing.html
app.get("/", (request, response) => {
  response.sendStatus(200);
});

app.get('/newemote', function(req, res) {
  res.render('index');
});


/* Commit Emote */


const fileInfo = {
  emoteBasePath: 'emotes/images/',
  emoteDescription: 'Add an emote.',
  jsonPath: 'emotes/emotes.json',
  jsonDescription: 'Update JSON',
  jsonEncode: true
};

app.post('/commit', jsonParser, function(req, res) {
  if(!isBodyValid(req.body, 'newemote')) {
    logger.log('warn', 'Received invalid commit request', req.body);
    return res.sendStatus(400);
  }
  
  githelper.getFile(fileInfo.jsonPath)
    .then((emoteList) => {
    logger.log('info', 'Got emote list');
    let file = processData(req.body, JSON.parse(emoteList));
    logger.log('info', 'Processed emote data');
    commitEmote(file)
      .then(() => {
      logger.log('info', 'Emote added');
      res.end('ok');
    }).catch(err => {
      logger.log('warn', 'Failed to add emote', err);
      res.end(err.toString());
    });
    }).catch(err => {
    logger.log('warn', 'Failed to get emote list', err);
    res.end(err.toString());
  });
});

function commitEmote(file) {
  return new Promise((resolve, reject) => {
    let filesToWrite = [];
    filesToWrite.push({
      filename: file.filename,
      content: file.content,
      description: fileInfo.emoteDescription
    });
    filesToWrite.push({
      filename: fileInfo.jsonPath,
      content: file.jsonContent,
      description: fileInfo.jsonDescription,
      encode: fileInfo.jsonEncode
    });
    githelper.writeFiles(filesToWrite).then(resolve()).catch(err => reject(err));
  });
}

function processData(data, emotes) {
  if (checkNameExists(data.emoteName, emotes)) {
    return {err: "Emote name already exists!"};
  }

  let emoteNumber = Object.keys(emotes).length + 1;

  emotes[emoteNumber] = data.emoteName + data.extension;
  let newJson = JSON.stringify(emotes);

  return {
    filename: fileInfo.emoteBasePath + emoteNumber + data.extension,
    content: base64.encode(data.content),
    width: data.width,
    jsonContent: newJson,
  };
}

function checkNameExists(emoteName, existingNames) {
  for (let key in existingNames) {
    if (existingNames.hasOwnProperty(key)) {
      let emote = existingNames[key].split('.');
      if (emote[0] === emoteName) {
        return key + "." + emote[1];
      }
    }
  }

  return false;
}


/* Modify Emote */


app.post('/modifygif', jsonParser, (req, res) => {
  if(!isBodyValid(req.body, 'modify')) {
    logger.log('warn', 'Received invalid modify request', req.body);
    return res.sendStatus(400);
  }
  
  let data = req.body;
  data.commands = getCommands(data.options);
  logger.log('info', 'Processed request commands', data.commands);
  
  processCommands(data)
    .then(buffer => {
    logger.log('info', 'Processed modified emote', {length: buffer.length});
    res.status(200);
    res.send(buffer.toString('base64'));
    }).catch(err => {
    logger.log('warn', 'Failed to modify emote ', err);
    res.status(400);
    res.send(err);
    });
});

function getCommands(options) {
  let normalCommands = [];
  let specialCommands = [];
  let priorityCommands = ['-U'];

  options.forEach((option) => {
    switch (option[0]) {
      case 'resize':
        priorityCommands.push('--scale');
        priorityCommands.push(option[1]);
        break;
      case 'flip':
        normalCommands.push('--flip-horizontal');
        break;
      case 'flap':
        normalCommands.push('--flip-vertical');
        break;
      case 'speed':
        normalCommands.push('-d' + Math.max(2, parseInt(option[1])));
        break;
      case 'hyperspeed':
        normalCommands.push('-I');
        break;
      case 'rotate':
      case 'reverse':
        specialCommands.push(option[0]);
        specialCommands.push(option[1]);
        break;
      case 'spin':
      case 'spinrev':
      case 'shake':
        let speed = 8;

        if (option[1]) {
          let speedName = option[1];

          if (speedName === 'fast') speed = 6;
          else if (speedName === 'faster') speed = 4;
          else if (speedName === 'hyper') speed = 2;
        }

        specialCommands.push(option[0]);
        specialCommands.push(speed);
        break;
    }
  });

  return [priorityCommands, specialCommands, normalCommands];
}

function processCommands(data) {
  return new Promise((resolve, reject) => {
    let fileType = data.url.endsWith('gif') ? 'gif' : 'png';
    let buffer = data.url;
    
    //We resize pngs through the canvas
    if(fileType === 'png') {
      let size = data.commands[0][2];
      processSpecialCommands({data: buffer, commands: data.commands[1], fileType: fileType, size: size})
        .then(buffer => {
        processNormalCommands(buffer, data.commands[2])
          .then(buffer => resolve(buffer))
          .catch(err => reject(err));
      }).catch(err => reject(err));
    } else {
      //Resize and unoptimize
      modifyGif(buffer, data.commands[0])
        .then(buffer => {
        processSpecialCommands({data: buffer, commands: data.commands[1], fileType: fileType})
          .then(buffer => {
          processNormalCommands(buffer, data.commands[2])
            .then(buffer => resolve(buffer))
            .catch(err => reject(err));
        }).catch(err => reject(err));
      }).catch(err => reject(err));
    }
  });
}

function modifyGif(data, options) {
  return new Promise((resolve, reject) => {
    let gifProcessor = new Gifsicle(options);
    let readStream;
    
    if (Buffer.isBuffer(data)) readStream = toStream(data);
    else {
      readStream = request(data, (err) => {
        if (err) reject(err);
      });
    }

    let buffers = [];
    readStream
      .pipe(gifProcessor)
      .on('data', (chunk) => buffers.push(chunk))
      .on('error', (err) => reject(err))
      .on('end', () => resolve(Buffer.concat(buffers)));
  });
}

function processSpecialCommands(options) {
  return new Promise((mainResolve, mainReject) => {
    let commands = options.commands;
    if (commands.length > 0) {
      let currentBuffer = options.data;
      
      logger.log('info', 'Commands count: ' + commands.length);
      for (let i = 0, p = Promise.resolve(); i < commands.length - 1; i += 2) {
        p = p.then(_ => new Promise((resolve, reject) => {
          processSpecialCommand({
            name: commands[i], 
            value: parseInt(commands[i + 1]), 
            buffer: currentBuffer, 
            type: options.fileType,
            size: options.size || 32
          }).then(buffer => {
            currentBuffer = buffer;
            if (i === commands.length - 2) {
              mainResolve(currentBuffer);
            } else resolve();
          }).catch(err => reject(err));
        })).catch(err => mainReject(err));
      }
    } else mainResolve(options.data);
  });
}

function processSpecialCommand(command) {
  return new Promise((resolve, reject) => {
    let type = '';
    
    logger.log('info', 'Command name: ' + command.name);
    switch (command.name) {
      case 'spin':
      case 'spinrev':
        type = command.type === 'gif' ? 'createRotatingGIF' : 'createRotatingPNG';
        gifmodify[type](command).then(buffer => resolve(buffer)).catch(err => reject(err));
        break;
      case 'shake':
        type = command.type === 'gif' ? 'createShakingGIF' : 'createShakingPNG';
        gifmodify[type](command).then(buffer => resolve(buffer)).catch(err => reject(err));
        break;
      case 'rotate':
        gifmodify.rotateGIF(command.buffer, command.value).then(buffer => resolve(buffer)).catch(err => reject(err));
        break;
      case 'reverse':
        gifmodify.reverseGIF(command.buffer).then(buffer => resolve(buffer)).catch(err => reject(err));
        break;
      default:
        resolve(command.buffer);
        break;
    };
  });
}

function processNormalCommands(data, commands) {
  return new Promise((resolve, reject) => {
    if(commands.length > 0) {
      modifyGif(data, commands)
        .then((buffer) => {
        //an asterisk, signifying info data
        if (buffer[0] === 42) {
          commands = trimInfoTag(commands);
          commands = removeEveryOtherFrame(2, commands, buffer);
          modifyGif(data, commands)
            .then((buffer) => {
            resolve(buffer);
          }).catch(err => reject(err));
        } else resolve(buffer);
      }).catch(err => reject(err));
    } else resolve(data);
  });
}

function trimInfoTag(commands) {
  let index = commands.indexOf('-I');
  if (index !== -1) {
    commands.splice(index, 1);
  }
  
  return commands;
}

function removeEveryOtherFrame(n, commands, data) {
  commands.push('-d2');
  
  let frameCount = data.toString('utf8').split('image #').length - 1;
  if (frameCount <= 4) return commands;
  commands.push('--delete');

  for (let i = 1; i < frameCount; i += n) {
    commands.push('#' + i);
  }

  return commands;
}





function isBodyValid(body, type) {
  if(type === 'modify') {
    return !!(body && body.url && body.options && Array.isArray(body.options));
  } else if(type === 'newemote') {
    return !!(body && body.emoteName && body.extension && body.content && body.width);
  }
}

// listen for requests :)
app.listen(process.env.PORT);
setInterval(() => {
  http.get(`http://${process.env.PROJECT_DOMAIN}.glitch.me/`);
}, 280000);
