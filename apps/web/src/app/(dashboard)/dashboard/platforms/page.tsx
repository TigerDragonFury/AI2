import { Share2 } from 'lucide-react';
import Link from 'next/link';

export const metadata = { title: 'Connected Platforms' };

const PLATFORMS = [
    { id: 'tiktok', name: 'TikTok', description: 'Short-form video (9:16)' },
    { id: 'youtube', name: 'YouTube', description: 'Long-form & Shorts (16:9)' },
    { id: 'instagram', name: 'Instagram', description: 'Reels & Feed (9:16, 1:1)' },
    { id: 'facebook', name: 'Facebook', description: 'Page videos' },
    { id: 'snapchat', name: 'Snapchat', description: 'Snap Ads (Business acct required)' },
];

export default function PlatformsPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Connected Platforms</h1>
                <p className="text-muted-foreground">Connect social accounts to publish your ads.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {PLATFORMS.map((platform) => (
                    <div
                        key={platform.id}
                        className="flex items-center justify-between rounded-lg border border-border bg-card p-5"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                                <Share2 className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                                <p className="font-medium">{platform.name}</p>
                                <p className="text-xs text-muted-foreground">{platform.description}</p>
                            </div>
                        </div>
                        <Link
                            href={`/api/auth/callback/${platform.id}`}
                            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                            Connect
                        </Link>
                    </div>
                ))}
            </div>
        </div>
    );
}
