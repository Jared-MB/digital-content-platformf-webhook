import { createServer } from "node:http";
import { Server } from "socket.io";
import express, { Response } from "express";
import { randomUUID } from "node:crypto";
import { Resend } from "resend";

import dotenv from "dotenv";
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

export interface Notification {
	id: string;
	type: "NEW_USER" | "NEW_BOOK" | "SYSTEM";
	title: string;
	message: string;
	read: boolean;
	createdAt: Date;
	data?: any;
}

const app = express();
const server = createServer(app);

const io = new Server(server, {
	cors: {
		origin: process.env.FRONTEND_URL || "http://localhost:3000",
		methods: ["GET", "POST"],
		credentials: true,
	},
});

const userConnections = new Map();

io.use((socket, next) => {
	const cookies = socket.handshake.headers.cookie;
	const userId = cookies
		?.split("; ")
		?.find((cookie) => cookie.startsWith("user-id"))
		?.split("=")[1];

	if (!userId) {
		next(new Error("No se proporcionó el ID de usuario"));
	}

	(socket as any).userId = userId || "anonymous";
	next();
});

io.on("connection", (socket) => {
	const userId = (socket as any).userId;

	console.log(`Usuario conectado: ${userId}`);

	if (!userConnections.has(userId)) {
		userConnections.set(userId, new Set());
	}
	userConnections.get(userId).add(socket.id);

	socket.join(`user:${userId}`);

	socket.on("disconnect", () => {
		console.log(`Usuario desconectado: ${userId}`);

		const userSockets = userConnections.get(userId);
		if (userSockets) {
			userSockets.delete(socket.id);
			if (userSockets.size === 0) {
				userConnections.delete(userId);
			}
		}
	});
});

function notifyUser(userId: string, notification: Notification) {
	io.to(`user:${userId}`).emit("notification", notification);
}

function notifyAll(notification: Notification) {
	io.emit("notification", notification);
}

app.use(express.json());

app.post("/api/notify/user/:userId", (req, res) => {
	const { userId } = req.params;
	const notificationData = req.body;

	const notification: Notification = {
		id: randomUUID(),
		...notificationData,
		createdAt: new Date(),
	};

	notifyUser(userId, notification);
	res.json({ success: true, notification });
});

app.post("/api/notify/all", (req, res) => {
	const notificationData = req.body;

	const notification: Notification = {
		id: randomUUID(),
		...notificationData,
		createdAt: new Date(),
	};

	notifyAll(notification);
	res.json({ success: true, notification });
});

app.get("/notify", (req, res) => {
	notifyAll({
		id: randomUUID(),
		type: "SYSTEM",
		title: "Notificación de prueba",
		message: "Esta es una notificación de prueba",
		read: false,
		data: {
			foo: "bar",
		},
		createdAt: new Date(),
	});
	res.json({ success: true });
});

app.post("/api/webhook/new-user", async (_, res: Response) => {
	if (!ADMIN_EMAIL) {
		res.status(400).json({ error: "Server error" });
		return;
	}

	const { data, error } = await resend.emails.send({
		from: "Quiosco Digital <noreply@transactional.kristall.app>",
		to: [ADMIN_EMAIL],
		subject: "Nuevo usuario registrado",
		html: `
            <strong>Hola, se ha registrado un nuevo usuario en la plataforma Quiosco Digital.</strong>
        `,
	});

	if (error) {
		res.status(400).json({ error });
		return;
	}

	res.status(200).json({ success: true, message: "Correo enviado con éxito" });
	return;
});

app.post("/api/webhook-notification", (req, res) => {
	console.log("HIT");
	console.log(req.body);
	try {
		const { type, data, targetUsers } = req.body;

		let title: string;
		let message: string;

		if (type === "NEW_BOOK") {
			title = "Nuevo libro disponible";
			message = `El libro "${data.title}" de ${data.author} ya está disponible`;
		} else if (type === "NEW_MAGAZINE") {
			title = "Nueva revista disponible";
			message = `La revista "${data.title}" de ${data.author} ya está disponible`;
		} else if (type === "NEW_ARTICLE") {
			title = "Nuevo artículo disponible";
			message = `El artículo "${data.title}" de ${data.author} ya está disponible`;
		} else {
			title = "Nueva notificación";
			message = "Tienes una nueva notificación";
		}

		const notification = {
			id: randomUUID(),
			type,
			title,
			message,
			read: false,
			createdAt: new Date(),
			data,
		};

		notifyAll(notification);

		res.json({
			success: true,
			message: "Notificación enviada con éxito",
			payload: notification,
		});
	} catch (error) {
		console.error("Error al procesar la notificación:", error);
		res.status(500).json({ error: "Error interno del servidor" });
	}
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
	console.log(`Servidor de WebSocket escuchando en el puerto ${PORT}`);
});
