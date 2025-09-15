const wrtc = require('@roamhq/wrtc');
const e = require('express');

class WebRTCConnectionManager {
    constructor(id, handler, servers, shouldReconnect=false) {
        this.id = id;
        this.handler = handler;
        this.isClosing = false;
        this.shouldReconnect = shouldReconnect;

        if (!this.handler.onSignalMessage || !this.handler.onDataMessage) {
            throw new Error("Handler is missing required methods");
        }

        this.setupConnection(servers);
    }

    setupConnection(servers) {
        this.peerConnection = new wrtc.RTCPeerConnection(servers);
        
        this.iceCandidates = [];
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.iceCandidates.push(event.candidate);
            }
        };

        this.signalingChannel = this.peerConnection.createDataChannel("signaling", { reliable: true });
        this.signalingChannel.onmessage = (event) => this.onSignalMessage(event.data);

        this.dataChannel = this.peerConnection.createDataChannel("data", { reliable: false });
        this.dataChannel.onmessage = (event) => this.handler.onDataMessage(event.data);
    }

    onSignalMessage(messageData) {
        let flags = messageData.split(' | ');
        const payload = flags[flags.length - 1];
        flags = flags.slice(0, -1);

        const passedFlags = flags.slice(1).length > 0? flags.slice(1) : [];
        // console.log(messageData, flags, payload);
        switch (flags[0]) {
            case 'MESSAGE':
                this.handler.onSignalMessage(passedFlags, payload);
                break;
            case 'RECONNECT':
                if (this.handler.onReconnect) this.handler.onReconnect(passedFlags, payload);
                if (this.handler.onSetup) this.handler.onSetup(passedFlags, payload);
                break;
            case 'OPEN':
                if (this.handler.onSetup) this.handler.onSetup(passedFlags, payload);
                if (this.handler.onOpen) this.handler.onOpen(passedFlags, payload);
                if (this.handler.passReconnect) {
                    this.sendSignaling('', [this.handler.reconnect? 'SHOULD_RECONNECT' : 'NO_RECONNECT'], true);
                }
                this.sendSignaling('', ['OPEN'], true);
                break;
            case 'CLOSE':
                if (this.handler.onClose) this.handler.onClose(passedFlags, payload);
                this.closeConnection();
                if (this.closeBackup) {
                    clearTimeout(this.closeBackup);
                }
                this.isClosing = true;
                break;
        }
    }

    async onClose(event) {
        if (!this.isClosing) {
            console.error(`Connection ${this.id} closed unexpectedly.`);
            if (this.handler.onClose) this.handler.onClose(event);
            if (this.handler.onConnectionError) this.handler.onConnectionError(event);
        } else {
            console.log(`Connection ${this.id} closed.`);
            if (this.handler.onClose) this.handler.onClose(event);
        }
        this.isClosing = false;
    }

    async getOffer() {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        return offer;
    }

    async receiveOffer(offer) {
        const rtcOffer = new wrtc.RTCSessionDescription(offer);
        await this.peerConnection.setRemoteDescription(rtcOffer);
    }

    async addCandidate(candidate) {
        await this.peerConnection.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
    }

    sendSignaling(message, flags, toConnManager=false) {
        if (!toConnManager) {
            flags.unshift('MESSAGE');
        }
        const fullMessage = flags.reduce((msg, flag) => `${msg}${flag} | `, '') + message;
        this.signalingChannel.send(fullMessage);
    }

    closeConnection() {
        this.isClosing = true;
        console.log(`Closing connection ${this.id}`);
        this.sendSignaling('', ['CLOSE'], true);
        this.closeBackup = setTimeout(() => {
            console.error('Peer did not confirm close. Closing anyway.');
            this.peerConnection.close();
        }, 1000);
    }
}

module.exports = WebRTCConnectionManager;
