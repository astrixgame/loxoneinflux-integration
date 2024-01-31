var request = require('request');
var fs = require('fs/promises');
var LxCommunicator = require('lxcommunicator');
var config = {};
var info = [];
var loxoneData = {};

var WebSocketConfig = LxCommunicator.WebSocketConfig;
var config = new WebSocketConfig(WebSocketConfig.protocol.WS, 'influx-is-logging-from-loxone', "", WebSocketConfig.permission.APP, false);

config.delegate = {
    socketOnEventReceived: function socketOnEventReceived(socket, events, type) {
        if(type === 2) {
            events.forEach(function(event) {
                if(loxoneData.controls[event.uuid]) {
                    preProcessData(loxoneData.controls[event.uuid]["name"], event.value);
                }
            });
        }
    }
};

var socket = new LxCommunicator.WebSocket(config);

setupConfig();

async function setupConfig() {
    await fs.readFile("./config.json").then((data) => {
        config = JSON.parse(data.toString());
        console.log("Config has loaded");
    }).catch((error) => {
        console.log("Cannot read config.json file error:");
        console.log(error);
    });
    getInfo();
}

async function getInfo() {
    console.log("Trying to get info file from "+config.loxoneAddr);
    await request({url : "http://"+config.loxoneAddr+"/stats/", headers : { "Authorization" : "Basic " + new Buffer(""+config.loxoneUser+":"+config.loxonePass).toString("base64")}},function (error, response, body) {
        var tmp = body.split('<a href="');
        tmp.forEach(element => {
            var dt = element.split("<")[0].split('">');
            if(dt[1]) {
                var dt1 = dt[1].toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(" ");
                if(dt1[0]=="teplota" || dt1[0]=="vlhkost" || dt1[0]=="svetlo" || dt1[0]=="spotreba") {
                    info[dt[0]]=dt1[0]+" "+dt1[1].replace("&#x148;","n");
                }
            }
        });
        request({url : "http://"+config.loxoneAddr+"/data/LoxAPP3.json", headers : { "Authorization" : "Basic " + new Buffer(""+config.loxoneUser+":"+config.loxonePass).toString("base64")}},function (error, response, body1) {
            loxoneData = JSON.parse(body1);
            loadHistory();
        });
    });
}

async function loadHistory() {
    var keyes = Object.keys(info);
    socket.open(config.loxoneAddr, config.loxoneUser, config.loxonePass).then(function() {
        socket.send("jdev/sps/enablebinstatusupdate");
    }, function(e) {
        console.error(e);
    });
    var lastTimestamp = config.lCheckDate;
    for(let i = 0; i < keyes.length; i++) {
        var key = keyes[i];
        request({url : "http://"+config.loxoneAddr+"/stats/"+key, headers : { "Authorization" : "Basic " + new Buffer(""+config.loxoneUser+":"+config.loxonePass).toString("base64")}},(error, response, body) => {
            console.log("http://"+config.loxoneAddr+"/stats/"+key);
            if(body) {
                body.split(" T=").forEach(async (e) => {
                    var dtt2 = e.replaceAll("\"","").replace("/>","").replace(/\r?\n|\r/,"").split("<")[0].split("V=");
                    if(dtt2[0] && dtt2[1] && dtt2[0].replace("-","").includes("-") && dtt2[0].replace(":","").includes(":") && dtt2[1].includes(".") && !dtt2[1].includes(">") && !dtt2[2] && config.lCheckDate <= getTimestamp(dtt2[0])) {
                        var tdtd = info[key].split(" ");
                        await console.log(tdtd[0] + " - " + tdtd[1] + " - " + getTimestamp(dtt2[0]) + " - " + dtt2[1]);
                        await saveDb(tdtd[0],tdtd[1],dtt2[1],getTimestamp(dtt2[0]));
                        lastTimestamp = getTimestamp(dtt2[0]);
                    }
                });
            }
        });
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    config.lCheckDate = lastTimestamp;
    fs.writeFile("config.json", JSON.stringify(config));
}

async function preProcessData(data, value) {
    var dt1 = data.toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(" ");
    if(dt1[0]=="teplota" || dt1[0]=="vlhkost" || dt1[0]=="svetlo" || dt1[0]=="spotreba") {
        dt1[1]=dt1[1].replace("&#x148;","n");
        await saveDb(dt1[0], dt1[1], value, 0);
    }
}

function saveDb(table, key, value, timestamp) {
    var time = "";
    if(timestamp != 0) {
        time = " "+timestamp;
    }
    request({ url: 'http://'+config.influxUser+':'+config.influxPass+'@'+config.influxAddr+'/write?db='+config.influxData, method: 'POST', pool: false, agent: false, buffer: 1024 * 1024 * 1024, headers: {'Content-Type':'application/x-www-form-urlencoded','Connection':'close'}, body: table+' '+key+'='+value+time });
    console.log("Saved: " + table + ", " + key + ", " + value + ", " + time);
}

function getTimestamp(str) {
    var dttt = str.split(' ');
    var dateComponents = dttt[0];
    var timeComponents = dttt[1];
    var [year, month, day] = dateComponents.split('-');
    var [hours, minutes, seconds] = timeComponents.split(':');
    var date = new Date(+year, month - 1, +day, +hours, +minutes, +seconds);
    var timestamp = date.getTime();
    return timestamp;
}

// teplota, vlhkost, světlo, spotřeba