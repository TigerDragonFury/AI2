import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { PrismaClient } from '@prisma/client';
import type { Adapter } from 'next-auth/adapters';
import { Resend } from 'resend';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY ?? 're_placeholder');

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) return null;

        // Password check would use bcrypt in production
        // For now, just return the user for scaffold purposes
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  session: {
    strategy: 'database',
  },
  callbacks: {
    async session({ session, user }) {
      if (user) {
        session.user.id = user.id;
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        session.user.role = dbUser?.role ?? 'user';
        // Mint a short-lived JWT so the web can call the API
        session.accessToken = jwt.sign(
          { userId: user.id, role: dbUser?.role ?? 'user' },
          process.env.API_JWT_SECRET!,
          { expiresIn: '15m' }
        );
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  events: {
    async createUser({ user }) {
      if (!user.email || !process.env.RESEND_API_KEY) return;
      resend.emails
        .send({
          from: process.env.EMAIL_FROM ?? 'AdAvatar <noreply@adavatar.app>',
          to: user.email,
          subject: 'Welcome to AdAvatar 🎉',
          html: `<h1>Welcome${user.name ? `, ${user.name}` : ''}!</h1><p>Thanks for joining AdAvatar. <a href="${process.env.NEXTAUTH_URL}/dashboard">Open your dashboard →</a></p>`,
        })
        .catch(console.error);
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
