import { Request, Response } from "express";
import SupportTicket from "../models/SupportTicket";
import { AuthRequest } from "../middleware/auth";
import Joi from "joi";

const createTicketSchema = Joi.object({
    subject: Joi.string().required(),
    message: Joi.string().required(),
});

const respondToTicketSchema = Joi.object({
    response: Joi.string().required(),
});

const idSchema = Joi.object({
    id: Joi.string().required()
});

// User: Create a support ticket
export const createTicket = async (req: Request, res: Response) => {
    try {
        const { error } = createTicketSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const { subject, message } = req.body;
        
        const ticket = await SupportTicket.create({
            user: userId,
            subject,
            message,
            status: "open",
        });

        res.status(201).json(ticket);
    } catch (err) {
        res.status(500).json({ error: 'Create ticket failed' });
    }
};

// User: Get own tickets
export const getMyTickets = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        const total = await SupportTicket.countDocuments({ user: userId });
        const tickets = await SupportTicket.find({ user: userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        res.json({
            tickets,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Fetch tickets failed' });
    }
};

// Admin: Get all tickets
export const getAllTickets = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        const total = await SupportTicket.countDocuments();
        const tickets = await SupportTicket.find()
            .populate("user", "email name")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        res.json({
            tickets,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Fetch all tickets failed' });
    }
};

// Admin: Respond to a ticket
export const respondToTicket = async (req: Request, res: Response) => {
    try {
        const { error } = respondToTicketSchema.validate(req.body);
        if (error) return res.status(400).json({ message: error.details[0].message });

        const { error: idError } = idSchema.validate({ id: req.params.id });
        if (idError) return res.status(400).json({ error: idError.details[0].message });

        const ticketId = req.params.id;
        const { response } = req.body;
        const ticket = await SupportTicket.findById(ticketId);
        if (!ticket) return res.status(404).json({ message: "Ticket not found" });
        
        ticket.response = response;
        ticket.status = "pending";
        await ticket.save();

        res.json({ ticket });
    } catch (error) {
        res.status(500).json({ error: 'Respond to ticket failed' });
    }
};

// Admin: Close a ticket
export const closeTicket = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const ticketId = req.params.id;
        const ticket = await SupportTicket.findById(ticketId);
        if (!ticket) return res.status(404).json({ message: "Ticket not found" });

        ticket.status = "closed";
        await ticket.save();
        
        res.json({ ticket });
    } catch (error) {
        res.status(500).json({ error: 'Close ticket failed' });
    }
};
