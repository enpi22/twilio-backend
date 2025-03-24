const express = require("express");
const twilio = require("twilio");
const bodyParser = require("body-parser");
const https = require("https");
const OpenAI = require("openai");
const { toFile } = require("openai");
const mongoose = require('mongoose');

const apiKey = "";
const openai = new OpenAI({
  apiKey: apiKey,
});


const mongoDBUrl = 'mongodb+srv://avisaha:avisaha1234@cluster0.d8rhqgt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';


mongoose.connect(mongoDBUrl);

const db = mongoose.connection;

db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB successfully');
});


const app = express();
const port = 3001;


const callHistorySchema = new mongoose.Schema({
    conferenceSid: String,
    reservationId: String,
    schedulerReservationId: String,
    reservationStatus: String,
    clientName: String,
    aircraftName: String,
    courseName: String,
    startDate: String,
    endDate: String,
    duration: String,
    recordingSid: String,
    timestamp: String,
    callStatus: String,
    twilioNo: String,
    from: String,
    to: String,
    recording: Buffer,
    transcriptText: String
  });

const CallHistory = mongoose.model('CallHistory', callHistorySchema);


let globalRowData = null;
function setRowData(row, phoneNumber1, phoneNumber2) {
  globalRowData = {
    ...row,
    phoneNumber1: phoneNumber1,
    phoneNumber2: phoneNumber2
  };
}
function getRowData() {
  return globalRowData;
}


let globalCallData = null;
function setCallData(participant) {
  globalCallData = participant;
}
function getCallData() {
  return globalCallData;
}


//paid account
const accountSid = "AC5e1df48fad63769a6727b57aa1b6fdf0";
const authToken = "";
const apiSecret = "";
const keySID = "s";


const client = twilio(accountSid, authToken);
const { VoiceResponse } = twilio.twiml;
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

const cors = require("cors");
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(express.json());
app.use(bodyParser.json());
app.use(cors());



const outgoingApplicationSid = "APc03342b3a4d394324c39a07a901f87b2";
app.get("/token", (req, res) => {
  const identity = req.query.identity || "BharatGolagana";

  const accessToken = new twilio.jwt.AccessToken(
    accountSid,
    keySID,
    apiSecret,
    { identity: identity }
  );

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: outgoingApplicationSid,
    incomingAllow: true, // Optional: add to allow incoming calls
  });

  accessToken.addGrant(voiceGrant);
  res.send({
    identity: identity,
    token: accessToken.toJwt(),
  });
});


app.all("/makeConferenceCall", async (req, res) => {
  const { phoneNumbers, row } = req.body;
  setRowData(row, phoneNumbers[0], phoneNumbers[1]);
  const twiml = new twilio.twiml.VoiceResponse();

  twiml.dial().conference({ record: true, statusCallback: 'http://52.90.112.51:3001/recordCallback' }, 'myconference');

  client.conferences('myconference')
    .participants
    .create({
      label: 'customer1',
      earlyMedia: true,
      beep: 'onEnter',
      from: '+18482767991',
      to: phoneNumbers[0],
      endConferenceOnExit: true
    })

  client.conferences('myconference')
    .participants
    .create({
      label: 'customer2',
      earlyMedia: true,
      beep: 'onEnter',
      statusCallback: 'http://52.90.112.51:3001/recordCallback',
      record: true,
      from: '+18482767991',
      to: phoneNumbers[1],
      endConferenceOnExit: true
    }).then((participant) => {
      setCallData(participant);
    }).catch(error => {
      console.error('Error sending participant information:', error);
    });
});

app.all("/recordCallback", async (req, res) => {
  const { RecordingSid, RecordingDuration, CallStatus, From, Timestamp } = req.body; //this From is twilio number
  const call = getCallData();
  const row = getRowData();

  try {
    await new Promise(resolve => setTimeout(resolve, 3000)); 
    const { transcriptText, recordingBuffer } = await downloadAndTranscribeRecording(RecordingSid);
    const callHistory = new CallHistory({
      conferenceSid: call.conferenceSid,
      reservationId: row.reservationId,
      schedulerReservationId: row.schedulerReservationId,
      reservationStatus: row.reservationStatus.status,
      clientName: row.clientName,
      aircraftName: row.aircraftName,
      courseName: row.courseName,
      startDate: row.startDate,
      endDate: row.endDate,
      duration: RecordingDuration,
      recordingSid: RecordingSid,
      timestamp: Timestamp,
      callStatus: CallStatus,
      twilioNo: From,
      from: row.phoneNumber1,
      to: row.phoneNumber2,
      recording: recordingBuffer,
      transcriptText: transcriptText
    });

    await callHistory.save();

    const twiml = new VoiceResponse();
    twiml.say("Thank you for your recording. Goodbye.");
    res.type("text/xml");
    res.send(twiml.toString());
  } catch (error) {
    console.error("Error:", error);
    const twiml = new VoiceResponse();
    twiml.say("An error occurred while processing your recording. Please try again later.");
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

async function downloadAndTranscribeRecording(RecordingSid) {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${RecordingSid}.wav`;
    const audioBuffer = await new Promise((resolve, reject) => {
      https.get(url, { auth: `${accountSid}:${authToken}` }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      }).on("error", reject);
    });
    const transcriptText = await transcribeWithOpenAI(audioBuffer);
    return {
      transcriptText: transcriptText,
      recordingBuffer: audioBuffer
    };
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}
async function transcribeWithOpenAI(audioBuffer) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: await toFile(audioBuffer, "audio.wav", {
        contentType: "audio/wav",
      }),
      model: "whisper-1",
    });

    return transcription.text;
  } catch (error) {
    console.error("Error during OpenAI transcription:", error);
    throw error;
  }
}


app.all('/callHistory/:schedulerReservationId', async (req, res) => {
  try {
    const { schedulerReservationId } = req.params;

    const callHistory = await CallHistory.find({ schedulerReservationId }).sort({ timestamp: -1 });
    if (!callHistory || callHistory.length === 0) {
      return res.status(404).json({ error: 'Call history not found' });
    }

    // Sort based on full date
    callHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const callHistoryWithBase64 = callHistory.map(item => {
      const recordingBase64 = item.recording.toString('base64');
      return { ...item.toObject(), recording: recordingBase64 };
    });

    res.json(callHistoryWithBase64);
  } catch (error) {
    console.error('No Call History here!', error);
    res.status(500).json({ error: 'Failed to fetch call history' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
