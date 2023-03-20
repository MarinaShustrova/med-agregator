const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const {User} = require('../../db/models')
const express = require('express');
const app = express();
const {google} = require('googleapis');
const {OAuth2Client} = require('google-auth-library');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
console.log("-> GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);


const jwtSecret = process.env.JWT_SECRET

exports.CheckUserAndCreateToken = async (req, res) => {
    try {
        const {username, password} = req.body;
        const user = await User.findOne({where: {username}})
        if (!user?.username) {
            return res.status(401).json({message: 'Authentication failed: Invalid username or password'});
        }
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({message: 'Authentication failed: Invalid username or password'});
        }
        const token = jwt.sign(
            {id: user.id, username: user.username},
            jwtSecret,
            {expiresIn: '5h'}
        );
        const userReady = await User.findOne({where: {username}, attributes: {exclude: ['password']},})
        if (userReady.username) {
            res.json({token, userReady, message: `Welcome, ${req.body.username}!`});
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({message: 'Server error'});
    }
};


exports.CreateUser = async (req, res) => {
    const {username, password, firstName, lastName, email, telephone, secretPhrase} = req.body;
    const truePhrase = process.env.SECRET_ADMIN_PHRASE;

    try {
        const existingUser = await User.findOne({where: {username}, attributes: {exclude: ['password']},});

        if (existingUser) {
            return res.status(409).json({message: 'Username already exists'});
        }

        if (!(username && password && firstName && lastName && email && telephone)) {
            return res.status(409).json({message: "Fields couldn't be empty!"});
        }

        if (!username || !username.match(/^[A-Za-z]\w+$/)) {
            return res.status(400).send({message: 'Invalid login format'});
        }

        if (username.length < 4) {
            return res
                .status(400)
                .send({message: 'Login must be at least 4 characters long'});
        }


        const regexTel = /^[0-9+-]+$/;
        if (!regexTel.test(telephone)) {
            return res.status(409).json({message: "Phone number consists of numbers (123), plus sign (+), and minus sign (-)."});
        }

        const regexName = /^[a-zA-Z]+(\s+[a-zA-Z]+)*$/;
        if (!regexName.test(firstName) || !regexName.test(lastName)) {
            return res.status(409).json({message: "String consists only of words."});
        }


        if (!/^[A-Z0-9a-z._%+-]+@[A-Z0-9a-z.-]+\.[A-Za-z]{2,}$/.test(email)) {
            return res.status(400).send({message: 'Invalid email address'});
        }

        if (!password || password.length < 3) {
            return res
                .status(400)
                .send({message: 'Password must be at least 3 characters long'});
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        if (secretPhrase === truePhrase) {
            try {
                const newAdmin = await User.create({
                    username,
                    password: passwordHash,
                    firstName,
                    lastName,
                    email,
                    telephone
                });
                res.json({message: 'New admin registered successfully'});
            } catch (err) {
                console.error(err);
                res.status(500).json({message: 'Failed to register admin'});
            }
        }
        const newUser = await User.create({username, password: passwordHash, firstName, lastName, email, telephone});
        if (newUser.username) {
            res.json({message: 'Registration successful!'})
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({message: 'Failed to register user'});
    }
};


exports.VerifyUser = async (req, res) => {
    try {

        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        jwt.verify(token, jwtSecret, async (err, decodedToken) => {
            if (err) {
                return res.status(401).json({message: 'Authentication failed: Invalid token'});
            }
            const {username} = decodedToken

            const userReady = await User.findOne({where: {username}, attributes: {exclude: ['password']},})
            res.json(userReady);
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({message: 'Server error'});
    }
};

exports.loginWithGoogle = async (req, res) => {
    try {
        const {username, userId} = req.body;


        const token = jwt.sign(
            {id: Number(userId), username},
            jwtSecret,
            {expiresIn: '5h'}
        );

        const userReady = await User.findOne({where: {username},})
        if (token) {
            res.json({token, userReady, message: `Welcome, ${userReady.firstName}!`});
        }
        if (!token) {
            res.json({message: 'Couldn\'t generate token!'});
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({message: 'Server error'});
    }
}

exports.googleCallback = async (req, res) => {
    const {token} = req.query;

    const data = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${token}`)
    const result = await data.json()

    if (result.name) {
        const trueLogin = result.sub
        let newUser;
        const userExisted = await User.findOne({where: {username: trueLogin}})
        const userId = userExisted?.id
        if (!userExisted) {
            newUser = await User.create({
                username: trueLogin,
                firstName: result.given_name,
                lastName: result.family_name,
                email: result.email,
                avatarGoogle: result.picture
            }, {raw: true, nest: true});
            const username = newUser?.username
            const userId = newUser?.id
            const data = await fetch('http://localhost:4000/auth/google/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({username, userId}),
            })
            const result = await data.json()
            if (result.token) {
                return res.json(result)
            }
            if (!result.token) {
               return res.json({message: 'Login is failed'})
            }
        }
        if (userExisted) {
            const username = userExisted?.username
            const data = await fetch('http://localhost:4000/auth/google/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({username, userId}),
            })
            const result = await data.json()
            if (result.token) {
                return res.json(result)
            }
            if (!result.token) {
                return res.json({message: 'Login is failed'})
            }

        }
    }


    // async function verify(client_id, jwtToken) {
    //     const client = new OAuth2Client(client_id);
    //     // Call the verifyIdToken to
    //     // varify and decode it
    //     const ticket = await client.verifyIdToken({
    //         idToken: jwtToken,
    //         audience: client_id,
    //     });
    //     const payload = ticket.getPayload();
    //     // This is a JSON object that contains
    //     // all the user info
    //     return payload;
    // }
    // // const verificationResponse = await verify(GOOGLE_CLIENT_ID, token);
    //
    // jwt.verify(token, GOOGLE_CLIENT_SECRET, (err, decodedToken) => {
    //     if (err) {
    //         console.error('Error decoding token:', err);
    //     } else {
    //         console.log('Decoded token:', decodedToken);
    //     }
    // });


    //
    // console.log("-> await oauth2Client.getToken(code)", await oauth2Client.getToken(code));
    //  const { tokens } = await oauth2Client.getToken(code);
    //  console.log("-> tokens", tokens);
    //  oauth2Client.setCredentials(tokens);
    //
    //
    //  const userInfo = await google.people({ version: 'v1', auth: oauth2Client }).people.get({
    //      resourceName: 'people/me',
    //      personFields: 'names,emailAddresses'
    //  });
    //
    //  const user = {
    //      id: userInfo.data.resourceName,
    //      name: userInfo.data.names[0].displayName,
    //      email: userInfo.data.emailAddresses[0].value
    //  };
    //
    //  const token = jwt.sign(user, jwtSecret, { expiresIn: '1h' });
    //  res.cookie('jwt', token, { httpOnly: true });
    //  res.redirect('/');
}

