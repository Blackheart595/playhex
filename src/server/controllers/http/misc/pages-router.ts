import { Router } from 'express';
import { getManifest } from './manifest-manager';
import { seo, jsonLd } from '../../../../shared/app/seo';

export function pagesRouter(): Router {
    const router = Router();

    // Render main page for any routes for html5 navigation
    router.get('/**', async (_, res) => {
        const manifest = await getManifest();

        const umami = {
            websiteId: process.env.UMAMI_WEBSITE_ID,
            src: process.env.UMAMI_SRC,
            domains: process.env.UMAMI_DOMAINS,
            hostUrl: process.env.UMAMI_HOST_URL,
        };

        res.render('page.ejs', {
            manifest,
            umami,
            seo,
            jsonLd,
            baseUrl: process.env.BASE_URL,
            sentryLoaderScript: process.env.SENTRY_LOADER_SCRIPT,
            blockRobotsIndex: 'true' === process.env.BLOCK_ROBOTS_INDEX,
        });
    });

    return router;
}
