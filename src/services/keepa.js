import axios from 'axios';
import 'dotenv/config';

const KEEPA_API_KEY = process.env.KEEPA_API_KEY;
const KEEPA_BASE_URL = 'https://api.keepa.com';

/**
 * FUNCTION: Get product price history/data using an ASIN (Amazon ID)
 * Keepa is primarily for Amazon data, often used to compare with eBay prices.
 */
export async function getProductData(asin) {
    try {
        // Keepa uses a 'key' query parameter for authentication
        const response = await axios.get(`${KEEPA_BASE_URL}/product`, {
            params: {
                key: KEEPA_API_KEY,
                domain: 1, // 1 is for Amazon.com (US)
                asin: asin,
                stats: 1   // Returns price statistics (buy box, 90-day averages)
            }
        });

        // Keepa returns an array of products
        return response.data.products ? response.data.products[0] : null;
    } catch (error) {
        console.error('Keepa API Error:', error.response?.data || error.message);
        return null;
    }
}