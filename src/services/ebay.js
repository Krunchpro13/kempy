import axios from 'axios';
import { createClient } from 'redis';

// 1. Setup Redis (The "Memory Cache")
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});
redisClient.on('error', (err) => console.log('Redis Client Error', err));
await redisClient.connect();

// 2. Get your Secret Keys from the .env file
const clientId = process.env.EBAY_SANDBOX_CLIENT_ID;
const clientSecret = process.env.EBAY_SANDBOX_CLIENT_SECRET;
const ebayApiBase = 'https://api.sandbox.ebay.com'; // Using Sandbox for safety

/**
 * FUNCTION: Gets the "Password" (Token) from eBay
 */
async function getEbayToken() {
    const cacheKey = 'ebay_access_token';
    
    // Check if we have a token saved in Redis already
    const cachedToken = await redisClient.get(cacheKey);
    if (cachedToken) {
        console.log('Using cached eBay token');
        return cachedToken;
    }

    console.log('Fetching new eBay token...');
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    try {
        const response = await axios.post(`${ebayApiBase}/identity/v1/oauth2/token`, 
            'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope', 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${authHeader}`
                }
            }
        );

        const token = response.data.access_token;
        const expiresIn = response.data.expires_in; // Usually 7200 seconds (2 hours)

        // Save token in Redis so we don't have to ask eBay again for 2 hours
        // We save it for 100 seconds less than it lasts to be safe
        await redisClient.set(cacheKey, token, {
            EX: expiresIn - 100 
        });

        return token;
    } catch (error) {
        console.error('Error getting eBay token:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * FUNCTION: Search for items
 */
export async function searchEbay(query) {
    const token = await getEbayToken();

    try {
        // This hits the "Browse API" to find items
        const response = await axios.get(`${ebayApiBase}/buy/browse/v1/item_summary/search`, {
            params: {
                q: query,
                limit: 10,
                // This filter looks for "Sold" items if supported by the endpoint
                filter: 'conditions:{NEW}' 
            },
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.itemSummaries || [];
    } catch (error) {
        console.error('Error searching eBay:', error.response?.data || error.message);
        return [];
    }
}