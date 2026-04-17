# BLW Content Hub

Content management and graphic generation tool for Big League Wiffle Ball (BLW).

## Features

- Dashboard with real-time team standings across all 10 BLW teams
- Content generator with 6 template types (game day, stat card, final score, leaderboards, standings)
- Downloadable PNG graphics at all standard social media sizes
- Request queue with approval workflow
- Stats Hub integrated with prowiffleball.com
- Asset browser for Dropbox and Google Drive
- Logo-accurate team branding

## Tech Stack

- React 18
- Vite
- React Router
- Canvas API for graphic generation

## Environment Variables

Create a `.env.local` file with:

```
VITE_PWB_API_KEY=your_api_key_here
VITE_PWB_API_URL=https://prowiffleball.com/api
```

Without the API key, the app uses cached snapshot data.

## Deployment

See `DEPLOYMENT.md` for step-by-step deployment instructions.

## License

Proprietary — for BLW content operations use only.
