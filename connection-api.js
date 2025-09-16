const express = require('express');
const WebRTCConnectionManager = require('./wrtc-connection-manager');
const crypto = require('crypto');

const app = express();
app.use(express.json());
const port = 3000;
const prefix = '/api';


const servers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ]
};

const connections = {};

function getHandler(type) {
  return {
    onSignalMessage: (msg) => console.log(`Received ${type} message:`, msg),
    onDataMessage: (msg) => console.log(`Received ${type} data message:`, msg),
    onClose: () => console.log(`Closed ${type} connection`),
    onError: (err) => console.error(`Error in ${type} connection:`, err),

    passReconnect: true,
    shouldReconnect: true
  };
}

app.get(`/`, (req, res) => {
  res.send('Hello World!');
});

app.post(`${prefix}/new-connection`, async (req, res) => {
  const handler = getHandler('default');
  const newConnection = new WebRTCConnectionManager(crypto.randomUUID(), handler, servers);
  connections[newConnection.id] = newConnection;
  console.log(`Created new connection: ${newConnection.id}...`);
  res.send(
    { id: newConnection.id, offer: await newConnection.getOffer() },
  );
});

app.get(`${prefix}/connections`, (req, res) => {
  res.send(Object.keys(connections).map(id => ({ id })));
});

app.post(`${prefix}/connections/:id/offer`, async (req, res) => {
    const { id } = req.params;
    const connection = connections[id];
    await connection.receiveOffer(req.body);
    res.status(200).send({ id, status: 'offer received' });
});

app.post(`${prefix}/connections/:id/candidate`, async (req, res) => {
    const { id } = req.params;
    const connection = connections[id];
    await connection.addCandidate(req.body);
    res.status(200).send({ id, status: 'candidate added' });
});

app.get(`${prefix}/connections/:id/candidates`, (req, res) => {
    const { id } = req.params;
    const connection = connections[id];
    res.send({ id, iceCandidates: connection.iceCandidates });
    connection.iceCandidates = [];
});

app.post(`${prefix}/connections/:id/reconnect`, async (req, res) => {
  const { id } = req.params;
  const connection = connections[id];
  console.log(`Attempting to reconnect ${id}...`);
  if (connection) {
      connection.setupConnection(servers);
      res.status(200).send({ id, offer: await connection.getOffer() });
  } else {
      res.status(404).send({ error: 'Connection not found' });
  }
});

app.delete(`${prefix}/connections/:id`, (req, res) => {
    const { id } = req.params;
    const connection = connections[id];
    if (connection) {
        connection.closeConnection();
        delete connections[id];
        res.send({ id, status: 'closed' });
    } else {
        res.status(404).send({ error: 'Connection not found' });
    }
    console.log(`Deleted connection ${id}`);
});

const server = app.listen(port, () => {
  console.log('Server running!');
});

let address = server.address().address;
if (address == '::') {
  address = 'localhost';
}

console.log(`Server listening at http://${address}:${port}`);