import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import mediasoupRouter from './api/mediasoup/router'; // Adjusted import
import { initMediasoup, router, rtpCapabilities } from './config/mediasoup';
import { Server as SocketIOServer } from 'socket.io';
import { connectTransport, createConsumerTransport, createTransport } from './services/mediasoup.service';
import { setMediasoupRouter } from './api/mediasoup/router';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3100;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

app.get('/', (_, res: Response) => {
    res.sendFile(path.join(__dirname, '../client', 'index.html'));
});

// Use the router for API routes
app.use('/api', mediasoupRouter);

app.get('/rtp-capabilities', (req, res) => {
    res.json(rtpCapabilities); // Ensure rtpCapabilities is defined and available
});


// Store all connected clients and their transports
const clients: { [key: string]: any } = {}; // Store client transports and media

async function startServer() {
    try {
        const routerInstance = await initMediasoup();
        setMediasoupRouter(routerInstance);

        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    io.emit('new-peer', socket.id); 

    // socket.on('getRtpCapabilities', (callback) => {
    //     if (router) {
    //         const rtpCapabilities = router.rtpCapabilities;
    //         if (callback && typeof callback === 'function') {
    //             callback({ rtpCapabilities });
    //         } else {
    //             console.error('No valid callback provided for RTP capabilities.');
    //         }
    //     } else {
    //         console.error('Router not initialized.');
    //     }
    // });

    socket.on('getRtpCapabilities', (callback) => {
        const rtpCapabilities = router.rtpCapabilities;
        console.log('Sending RTP Capabilities:', rtpCapabilities);
        callback({ rtpCapabilities });
    });

    socket.on('create-transport', async () => {
        try {
            const transport = await createTransport();
            clients[socket.id] = {
                transport,
                producers: []
            };
            socket.emit('transport-created', {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            });
            console.log(`Transport created for ${socket.id} Transport ID: ${transport.id}`);
        } catch (error) {
            socket.emit('error', `Failed to create transport: ${error}`);
        }
    });

    socket.on('connect-transport', async ({ transportId, dtlsParameters }) => {
        try {
            await connectTransport(transportId, dtlsParameters);
            console.log(`Transport connected successfully: ${transportId}`); // Log success message
            socket.emit('transport-connected', transportId);
        } catch (error) {
            console.error(`Failed to connect transport: ${error}`); // Log error message
            socket.emit('error', `Failed to connect transport: ${error}`);
        }
    });;

    socket.on('produce', async ({ kind, rtpParameters }) => {
        try {
            const producer = await clients[socket.id].transport.produce({ kind, rtpParameters });
            clients[socket.id].producers.push(producer);
    
            console.log(`New producer created by ${socket.id}, Producer ID: ${producer.id}, Kind: ${kind}`);
    
            // Notify other clients about the new producer
            socket.broadcast.emit('new-producer', {
                producerId: producer.id,
                socketId: socket.id,
                kind,
            });
    
            // Create a consumer for each client that needs to receive this producer's track
            for (const clientId in clients) {
                if (clientId !== socket.id) {
                    const consumerTransport = await createConsumerTransport(clientId); // Create a transport for the consumer
                    const consumer = await consumerTransport.consume({
                        producerId: producer.id,
                        rtpCapabilities: clients[clientId].rtpCapabilities // Pass the rtpCapabilities of the receiving client
                    });
    
                    console.log(`Consumer created for ${clientId} to receive producer ${producer.id}`);
    
                    // Send the consumer's parameters to the appropriate client
                    io.to(clientId).emit('new-consumer', {
                        producerId: producer.id,
                        consumerId: consumer.id,
                        kind: producer.kind,
                        rtpParameters: consumer.rtpParameters,
                        transportId: consumerTransport.id,
                    });
    
                    // Add event listeners for the consumer
                    consumer.on('transportclose', () => {
                        console.log(`Consumer transport closed for ${clientId}`);
                    });
    
                    consumer.on('producerclose', () => {
                        console.log(`Producer ${producer.id} closed for consumer ${clientId}`);
                        socket.emit('producer-closed', { producerId: producer.id });
                    });
                }
            }
    
            // Mediasoup supported producer events
            producer.on('transportclose', () => {
                console.log('Producer transport closed:', producer.id);
            });
    
            producer.on('producerclose', () => {
                console.log('Producer closed:', producer.id);
                socket.broadcast.emit('producer-closed', { producerId: producer.id });
            });
    
        } catch (error) {
            console.error('Error producing track:', error);
            socket.emit('error', `Failed to produce track: ${error}`);
        }
    });

    async function consume(socketId: string, producerId: string) {
        try {
            const consumerTransport = await createConsumerTransport(socketId);
            const consumer = await consumerTransport.consume({
                producerId,
                rtpCapabilities: clients[socketId].rtpCapabilities,
            });
    
            console.log(`Consumer ${consumer.id} created for Producer ${producerId} and Client ${socketId}`);
    
            // Return consumer details to the client
            return {
                consumerId: consumer.id,
                producerId,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
                transportId: consumerTransport.id,
            };
        } catch (error) {
            console.error('Error creating consumer:', error);
            throw new Error(`Failed to consume: ${error}`);
        }
    }
    
    // Example usage of the consume function when needed (e.g., after producing)
    socket.on('create-consumer', async ({ producerId }) => {
        try {
            const consumerData = await consume(socket.id, producerId);
            socket.emit('consumer-created', consumerData);
        } catch (error) {
            socket.emit('error', `Failed to create consumer: ${error}`);
        }
    });


    // When a client disconnects, clean up their resources
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        const client = clients[socket.id];
        if (client) {
            client.producers.forEach((producer: any) => producer.close());
            client.transport.close();
            delete clients[socket.id];

            // Notify all clients about the disconnection
            socket.broadcast.emit('peer-disconnected', socket.id);
        }
    });
});

startServer();
