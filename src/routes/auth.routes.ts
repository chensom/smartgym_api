import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { auth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { loginSchema, refreshSchema } from '../schemas/auth.schema';

const router = Router();

// POST /api/v1/auth/login
router.post('/login',   validate(loginSchema),   authController.login);

// POST /api/v1/auth/refresh
router.post('/refresh', validate(refreshSchema),  authController.refresh);

// GET  /api/v1/auth/me  (requiere token)
router.get('/me', auth, authController.me);

export default router;
