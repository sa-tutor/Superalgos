exports.newNetworkModulesWebSocketsNetworkClient = function newNetworkModulesWebSocketsNetworkClient() {

    let thisObject = {
        id: undefined,
        socket: undefined,
        isConnected: undefined,
        host: undefined,
        port: undefined,
        callerRole: undefined,
        p2pNetworkClient: undefined,
        p2pNetworkNode: undefined,
        p2pNetworkClientIdentity: undefined,
        p2pNetworkClientCodeName: undefined,
        onConnectionClosedCallBack: undefined,
        sendMessage: sendMessage,
        initialize: initialize,
        finalize: finalize
    }

    let web3
    let called = {}
    let onMessageFunctionsMap = new Map()

    return thisObject

    function finalize() {
        thisObject.socket.close()
        thisObject.socket = undefined
        thisObject.id = undefined
        thisObject.isConnected = undefined
        thisObject.host = undefined
        thisObject.port = undefined
        thisObject.callerRole = undefined
        thisObject.p2pNetworkNode = undefined
        thisObject.p2pNetworkClient = undefined
        thisObject.p2pNetworkClientIdentity = undefined
        thisObject.onConnectionClosedCallBack = undefined

        web3 = undefined
        called = undefined
        onMessageFunctionsMap = undefined
    }

    async function initialize(callerRole, p2pNetworkClientIdentity, p2pNetworkNode, p2pNetworkClient, onConnectionClosedCallBack) {

        thisObject.callerRole = callerRole
        thisObject.p2pNetworkClientIdentity = p2pNetworkClientIdentity
        thisObject.p2pNetworkClientCodeName = thisObject.p2pNetworkClientIdentity.node.config.codeName
        thisObject.p2pNetworkNode = p2pNetworkNode
        thisObject.p2pNetworkClient = p2pNetworkClient
        thisObject.onConnectionClosedCallBack = onConnectionClosedCallBack

        web3 = new SA.nodeModules.web3()

        thisObject.id = SA.projects.foundations.utilities.miscellaneousFunctions.genereteUniqueId()

        thisObject.host = thisObject.p2pNetworkNode.node.config.host
        thisObject.port = thisObject.p2pNetworkNode.node.config.webSocketsPort

        thisObject.socket = new SA.nodeModules.ws('ws://' + thisObject.host + ':' + thisObject.port)
        await setUpWebSocketClient()

        console.log('Websockets Client Connected to Network Node via Web Sockets .................. Connected to ' + thisObject.p2pNetworkNode.userProfile.config.codeName + ' -> ' + thisObject.p2pNetworkNode.node.name + ' -> ' + thisObject.host + ':' + thisObject.port)
        thisObject.isConnected = true
    }

    async function setUpWebSocketClient() {

        return new Promise(connectToNewtwork)

        function connectToNewtwork(resolve, reject) {

            try {

                thisObject.socket.onopen = () => { onConnectionOpened() }
                thisObject.socket.onclose = () => { onConnectionClosed() }
                thisObject.socket.onerror = err => { onError(err) }

                function onConnectionOpened() {

                    handshakeProcedure()

                    function handshakeProcedure() {

                        let callerTimestamp

                        stepOneRequest()

                        function stepOneRequest() {
                            /*
                            Send Handshake Message Step One:
         
                            At Step One we will just say hello, identify ourselves
                            as a Network Client, and send the Network Node our 
                            User Profile Handle.
         
                            This Handle will be signed by the Network Node to prove
                            it's own identity, and later we will sign it's own handle
                            to prove ours.
                            */
                            thisObject.socket.onmessage = socketMessage => { stepOneResponse(socketMessage) }

                            callerTimestamp = (new Date()).valueOf()

                            let message = {
                                messageType: 'Handshake',
                                callerRole: thisObject.callerRole,
                                callerProfileHandle: SA.secrets.signingAccountSecrets.map.get(thisObject.p2pNetworkClientCodeName).userProfileHandle,
                                callerTimestamp: callerTimestamp,
                                step: 'One'
                            }
                            thisObject.socket.send(JSON.stringify(message))
                        }

                        function stepOneResponse(socketMessage) {
                            let response = JSON.parse(socketMessage.data)

                            if (response.result !== 'Ok') {
                                console.log('[ERROR] Web Sockets Network Client -> stepOneResponse -> response.message = ' + response.message)
                                reject()
                                return
                            }

                            let signature = JSON.parse(response.signature)
                            called.blockchainAccount = web3.eth.accounts.recover(signature)
                            /*
                            We will check that the signature received produces a valid Blockchain Account.
                            */
                            if (called.blockchainAccount === undefined) {
                                console.log('[ERROR] Web Sockets Network Client -> stepOneResponse -> Signature does not produce a valid Blockchain Account.')
                                reject()
                                return
                            }
                            /*
                            We will check that the blockchain account taken from the signature matches
                            the one we have on record for the user profile of the Network Node we are calling.
                            */
                            if (called.blockchainAccount !== thisObject.p2pNetworkNode.blockchainAccount) {
                                console.log('[ERROR] Web Sockets Network Client -> stepOneResponse -> The Network Node called does not have the expected Blockchain Account.')
                                reject()
                                return
                            }

                            let signedMessage = JSON.parse(signature.message)
                            /*
                            We will verify that the signature belongs to the signature.message.
                            To do this we will hash the signature.message and see if we get 
                            the same hash of the signature.
                            */
                            let hash = web3.eth.accounts.hashMessage(signature.message)
                            if (hash !== signature.messageHash) {
                                console.log('[ERROR] Web Sockets Network Client -> stepOneResponse -> signature.message Hashed Does Not Match signature.messageHash.')
                                reject()
                                return
                            }
                            /*
                            We will check that the Network Node that responded has the same User Profile Handle
                            that we have on record, otherwise something is wrong and we should not proceed.
                            */
                            if (signedMessage.calledProfileHandle !== thisObject.p2pNetworkNode.userProfile.config.codeName) {
                                console.log('[ERROR] Web Sockets Network Client -> stepOneResponse -> The Network Node called does not have the expected Profile codeName.')
                                reject()
                                return
                            }
                            /*
                            We will check that the profile handle we sent to the Network Node, is returned at the
                            signed message, to avoid man in the middle attacks.
                            */
                            if (signedMessage.callerProfileHandle !== SA.secrets.signingAccountSecrets.map.get(thisObject.p2pNetworkClientCodeName).userProfileHandle) {
                                console.log('[ERROR] Web Sockets Network Client -> stepOneResponse -> The Network Node callerProfileHandle does not match my own userProfileHandle.')
                                reject()
                                return
                            }
                            /*
                            We will also check that the callerTimestamp we sent to the Network Node, is returned at the
                            signed message, also to avoid man in the middle attacks.
                            */
                            if (signedMessage.callerTimestamp !== callerTimestamp) {
                                console.log('[ERROR] Web Sockets Network Client -> stepOneResponse -> The Network Node callerTimestamp does not match my own callerTimestamp.')
                                reject()
                                return
                            }

                            /*
                            All validations passed, it seems we can continue with Step Two.
                            */
                            stepTwoRequest(signedMessage)
                        }

                        function stepTwoRequest(signedMessage) {
                            /*
                            Send Handshake Message Step Two:
         
                            Here we will sign a message with the Network Node profile 
                            handle and timestamp to prove our own identity.
                            */
                            thisObject.socket.onmessage = socketMessage => { stepTwoResponse(socketMessage) }

                            let signature = web3.eth.accounts.sign(JSON.stringify(signedMessage), SA.secrets.signingAccountSecrets.map.get(thisObject.p2pNetworkClientCodeName).privateKey)

                            let message = {
                                messageType: 'Handshake',
                                signature: JSON.stringify(signature),
                                step: 'Two'
                            }
                            thisObject.socket.send(JSON.stringify(message))
                        }

                        function stepTwoResponse(socketMessage) {
                            let response = JSON.parse(socketMessage.data)

                            if (response.result !== 'Ok') {
                                console.log('[ERROR] Web Sockets Network Client -> stepOneResponse -> response.message = ' + response.message)
                                reject()
                                return
                            }
                            /*
                            This was the end of the Handshake procedure. We are connected to the
                            Network Node and from now on, all response messages will be received
                            at this following function.
                            */
                            thisObject.socket.onmessage = socketMessage => { onMenssage(socketMessage) }
                            resolve()
                        }
                    }
                }

                function onConnectionClosed() {
                    if (thisObject.isConnected === true) {
                        console.log('Websockets Client Disconnected from Network Node via Web Sockets ............. Disconnected from ' + thisObject.p2pNetworkNode.userProfile.config.codeName + ' -> ' + thisObject.p2pNetworkNode.node.name + ' -> ' + thisObject.host + ':' + thisObject.port)
                    }
                    if (thisObject.onConnectionClosedCallBack !== undefined) {
                        thisObject.onConnectionClosedCallBack(thisObject.id)
                    }
                    thisObject.isConnected = false
                }

                function onError(err) {
                    if (err.message.indexOf('ECONNREFUSED') >= 0) {
                        console.log('[WARN] Web Sockets Network Client -> onError -> Nobody home at ' + thisObject.host + ':' + thisObject.port)
                        reject()
                        return
                    }
                    console.log('[ERROR] Web Sockets Network Client -> onError -> err.message = ' + err.message)
                    console.log('[ERROR] Web Sockets Network Client -> onError -> err.stack = ' + err.stack)
                    reject()
                    return
                }

            } catch (err) {
                console.log('[ERROR] Web Sockets Network Client -> setUpWebSocketClient -> err.stack = ' + err.stack)
            }

        }
    }

    function sendMessage(message) {

        return new Promise(sendSocketMessage)

        function sendSocketMessage(resolve, reject) {

            if (thisObject.socket.readyState !== 1) { // 1 means connected and ready.
                console.log('[ERROR] Web Sockets Network Client -> sendMessage -> Cannot send message while connection is closed.')
                reject('Websockets Connection Not Ready.')
                return
            }

            let socketMessage = {
                messageId: SA.projects.foundations.utilities.miscellaneousFunctions.genereteUniqueId(),
                messageType: 'Request',
                payload: message
            }
            onMessageFunctionsMap.set(socketMessage.messageId, onMenssageFunction)
            thisObject.socket.send(
                JSON.stringify(socketMessage)
            )

            function onMenssageFunction(response) {
                try {
                    if (response.result === 'Ok' || response.result === 'Warning') {
                        resolve(response.data)
                    } else {
                        console.log('[ERROR] Web Sockets Network Client -> onMenssageFunction -> response.message = ' + response.message)
                        reject(response.message)
                    }
                } catch (err) {
                    callbackFunction = undefined
                    console.log('[ERROR] Web Sockets Network Client -> err.stack = ' + err.stack)
                }
            }
        }
    }

    function onMenssage(socketMessage) {

        let messageHeader = JSON.parse(socketMessage.data)
        /*
        We get the function that is going to resolve or reject the promise given.
        */
        let onMenssageFunction = onMessageFunctionsMap.get(messageHeader.messageId)

        if (onMenssageFunction !== undefined) {
            processAnswerToARequest(messageHeader)
        } else {
            processNotification(messageHeader)
        }

        function processAnswerToARequest(messageHeader) {
            /*
            The message received is a response to a message sent.
            */
            onMessageFunctionsMap.delete(messageHeader.messageId)
            onMenssageFunction(messageHeader)
        }

        function processNotification(messageHeader) {
            /*
            The message received is a not response to a message sent.
            That means that it is a notification received from the Network Node
            of an event or signal that happened at some other Client of the Network.

            This can only happen when this module is running at an APP like 
            the Desktop App, Server App, Platform App, or Task Server App.
            */
            switch (messageHeader.networkService) {
                case 'Social Graph': {
                    if (thisObject.p2pNetworkClient.socialGraphNetworkServiceClient !== undefined) {
                        thisObject.p2pNetworkClient.socialGraphNetworkServiceClient.p2pNetworkInterface.messageReceived(
                            messageHeader.payload,
                            thisObject.p2pNetworkClient.eventReceivedCallbackFunction
                        )
                    } else {
                        console.log('[WARN] Web Sockets Network Client -> Social Graph Network Service Client Not Running')
                    }
                    break
                }
                case 'Trading Signals': {
                    if (thisObject.p2pNetworkClient.tradingSignalsNetworkServiceClient !== undefined) {
                        thisObject.p2pNetworkClient.tradingSignalsNetworkServiceClient.p2pNetworkInterface.messageReceived(
                            messageHeader.payload,
                            thisObject.p2pNetworkClient.eventReceivedCallbackFunction
                        )
                    } else {
                        console.log('[WARN] Web Sockets Network Client -> Trading Signals Network Service Client Not Running')
                    }
                    break
                }
                default: {
                    console.log('[WARN] Web Sockets Network Client -> Network Service Not Supported -> messageHeader.networkService = ' + messageHeader.networkService)
                }
            }
        }
    }
}