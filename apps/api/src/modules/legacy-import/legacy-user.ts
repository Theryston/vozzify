import { z } from 'zod';

const date = z.preprocess(
  (value) => (typeof value === 'string' ? new Date(value) : value),
  z.date(),
);
const nullableText = z.string().nullable();
const accountSchema = z.object({
  provider: z.literal('google'),
  accountId: z.string().min(1),
  accessToken: nullableText,
  refreshToken: nullableText,
  idToken: nullableText,
  scope: nullableText,
  expiresAt: z.number().int().nullable(),
  createdAt: date,
  updatedAt: date,
});

export const legacyUserSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(['USER', 'ADMIN']),
    name: nullableText,
    email: z.email(),
    username: nullableText,
    password: z
      .string()
      .regex(/^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/)
      .nullable(),
    emailVerifiedAt: date.nullable(),
    image: nullableText,
    dailyPracticeTargetSeconds: z.number().int().nullable(),
    createdAt: date,
    updatedAt: date,
    accounts: z.array(accountSchema),
  })
  .refine((user) => user.password !== null || user.accounts.length > 0);

export type LegacyUser = z.infer<typeof legacyUserSchema>;

export const importedUserValues = (user: LegacyUser) => ({
  id: user.id,
  role: user.role,
  name:
    user.name ?? user.username?.toLowerCase() ?? user.email.split('@')[0] ?? '',
  email: user.email.toLowerCase(),
  username: user.username?.toLowerCase() ?? null,
  emailVerified: user.emailVerifiedAt !== null || user.accounts.length > 0,
  image: user.image,
  dailyPracticeTargetSeconds: user.dailyPracticeTargetSeconds,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const importedAccountValues = (user: LegacyUser) => [
  ...(user.password === null
    ? []
    : [
        {
          userId: user.id,
          providerId: 'credential',
          accountId: user.id,
          password: user.password,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      ]),
  ...user.accounts.map(({ provider, expiresAt, ...account }) => ({
    ...account,
    userId: user.id,
    providerId: provider,
    accessTokenExpiresAt:
      expiresAt === null ? null : new Date(expiresAt * 1000),
  })),
];
