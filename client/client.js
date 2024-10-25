const socket = io('http://localhost:3100/');
const localVideo = document.getElementById('local-video');
const remoteVideosContainer = document.getElementById('remote-videos');

let device;
let localStream;
let sendTransport; 
let remoteClients = {}; 

// Get user media
async function getUserMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localVideo.srcObject = localStream;
        socket.emit('create-transport');
    } catch (error) {
        console.error('Error accessing media devices.', error);
    }
}

async function fetchRtpCapabilities() {
    try {
        const response = await fetch('http://localhost:3100/rtp-capabilities'); // Ensure this matches your server's route
        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('Response data:', data);

        if (!response.ok) {
            throw new Error(`Error fetching RTP Capabilities: ${data.error || response.statusText}`);
        }
        return data.rtpCapabilities; // Assuming your server returns { rtpCapabilities: ... }
    } catch (error) {
        console.error('Error fetching RTP Capabilities:', error);
        throw error;
    }
}
async function createDevice() {
    try {
        console.log('Creating Mediasoup device...');
        device = new mediasoupClient.Device();

        const rtpCapabilities = await fetchRtpCapabilities(); // Call the fetch function
        console.log('RTP Capabilities received:', rtpCapabilities);

        await device.load({ routerRtpCapabilities: rtpCapabilities });
        console.log('Device created and loaded successfully.');
    } catch (error) {
        console.error('Error creating and loading device:', error);
        alert('Failed to initialize device. Please check your connection and try again.');
        throw error;
    }
}

// async function createDevice() {
//     try {
//         console.log('Creating Mediasoup device...');
//         device = new mediasoupClient.Device();

//         // Request RTP capabilities from the server
//         const rtpCapabilities = await new Promise((resolve, reject) => {
//             socket.emit('getRtpCapabilities', (data) => {
//                 if (data.error) {
//                     reject(new Error('Error fetching RTP Capabilities: ' + data.error));
//                 } else {
//                     resolve(data.rtpCapabilities);
//                 }
//             });
//         });

//         console.log('RTP Capabilities received:', rtpCapabilities);

//         // Load the device with the router RTP capabilities received from the server
//         await device.load({ routerRtpCapabilities: rtpCapabilities });
//         console.log('Device created and loaded successfully.');
//     } catch (error) {
//         console.error('Error creating and loading device:', error);
//         alert('Failed to initialize device. Please check your connection and try again.');
//         throw error;
//     }
// }


socket.emit('getRtpCapabilities');

// socket.on('rtpCapabilities', (capabilities) => {
//     const device = new Device(); // Assuming Device is properly imported
//     device.load(capabilities)
//         .then(() => {
//             console.log('Device loaded successfully');
//         })
//         .catch((error) => {
//             console.error('Error loading device:', error);
//         });
// });

socket.on('rtpCapabilities', (rtpCapabilities) => {
    console.log('Received RTP Capabilities:', rtpCapabilities);
    createDevice();
});


// Socket event for transport creation
socket.on('transport-created', async (data) => {
    await createDevice();
    sendTransport = device.createSendTransport(data); // Store send transport

    sendTransport.on('connect', async ({ dtlsParameters }, callback) => {
        socket.emit('connect-transport', { transportId: sendTransport.id, dtlsParameters });
        callback();
    });

    // Send audio and video producers
    const videoTrack = localStream.getVideoTracks()[0];
    const audioTrack = localStream.getAudioTracks()[0];

    try {
        await sendTransport.produce({ track: videoTrack, appData: { kind: 'video' } });
        await sendTransport.produce({ track: audioTrack, appData: { kind: 'audio' } });
        console.log('Audio and video tracks sent.');
    } catch (error) {
        console.error('Error producing track:', error);
    }
});

// When a new peer connects
socket.on('new-peer', (peerId) => {
    const remoteVideo = document.createElement('video');
    remoteVideo.id = `remote-${peerId}`;
    remoteVideo.autoplay = true;
    remoteVideo.style.width = '200px'; // Example styling
    remoteVideo.style.height = '150px'; // Example styling
    remoteVideosContainer.appendChild(remoteVideo);
    remoteClients[peerId] = remoteVideo; // Store the remote video element
});

// Handle receiving new consumers
socket.on('new-consumer', async ({ producerId, consumerId, kind, rtpParameters, transportId }) => {
    const remoteVideo = remoteClients[socketId];

    // Create a new consumer transport for receiving the producer's track
    const consumerTransport = device.createRecvTransport({ /* Transport parameters here */ });

    consumerTransport.on('connect', async ({ dtlsParameters }, callback) => {
        socket.emit('connect-transport', { transportId: consumerTransport.id, dtlsParameters });
        callback();
    });

    const consumer = await consumerTransport.consume({ id: producerId, rtpParameters });
t
    if (remoteVideo) {
        const remoteStream = new MediaStream([consumer.track]);
        remoteVideo.srcObject = remoteStream;
    }

    consumer.on('trackended', () => {
        console.log('Consumer track ended:', consumerId);
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null; // Clear the video element
    });
});


// Handle receiving remote tracks
socket.on('new-producer', async ({ producerId, socketId }) => {
    const remoteVideo = remoteClients[socketId];

    // Create a new consumer for the producer
    const consumerTransport = device.createRecvTransport(/* Transport parameters here */);

    consumerTransport.on('connect', async ({ dtlsParameters }, callback) => {
        socket.emit('connect-transport', { transportId: consumerTransport.id, dtlsParameters });
        callback();
    });

    // Receive the track
    const { rtpParameters } = await socket.emit('consume', { producerId, transportId: consumerTransport.id });
    const consumer = await consumerTransport.consume({ id: producerId, rtpParameters });

    // Add the track to the remote video element
    if (remoteVideo) {
        const remoteStream = new MediaStream([consumer.track]);
        remoteVideo.srcObject = remoteStream;
    }
});

// When a producer closes
socket.on('producer-closed', ({ producerId }) => {
    for (const [clientId, remoteVideo] of Object.entries(remoteClients)) {
        if (producerId === clientId) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
            remoteVideosContainer.removeChild(remoteVideo);
            delete remoteClients[clientId]; // Remove from the client list
            break;
        }
    }
});

// Handle peer disconnection
socket.on('peer-disconnected', (peerId) => {
    const remoteVideo = document.getElementById(`remote-${peerId}`);
    if (remoteVideo) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
        remoteVideosContainer.removeChild(remoteVideo);
        delete remoteClients[peerId]; // Remove from remote clients
    }
});

// Function to end the call
function endCall() {
    localStream.getTracks().forEach(track => track.stop());
    socket.emit('call-ended', socket.id);
    while (remoteVideosContainer.firstChild) {
        remoteVideosContainer.removeChild(remoteVideosContainer.firstChild);
    }
    console.log('Call ended.');
}

// When a call ends
socket.on('call-ended', (peerId) => {
    console.log(`Call ended by peer: ${peerId}`);
    const remoteVideo = document.getElementById(`remote-${peerId}`);
    if (remoteVideo) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
        remoteVideosContainer.removeChild(remoteVideo);
        delete remoteClients[peerId]; // Remove from remote clients
    }
});

// Start the app
getUserMedia();
