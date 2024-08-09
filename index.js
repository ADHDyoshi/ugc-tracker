const fs = require('fs');
const fetch = require('node-fetch');
const path = require('path');

const itemsFilePath = path.join(__dirname, 'items.txt');
const sentItemsFilePath = path.join(__dirname, 'sent_items.txt');
const discordWebhookUrl = ""; // Variable used for webhooks, place your webhook here!

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper to read IDs from a file and return as a Set
const readIdsFromFile = (filePath) => {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf-8');
    }
    return new Set(fs.readFileSync(filePath, 'utf-8').split('\n').filter(id => id.trim()));
};

// Helper to ensure the number of entries in sent_items.txt is limited to 150 lines
const limitSentItems = () => {
    if (fs.existsSync(sentItemsFilePath)) {
        let sentItems = fs.readFileSync(sentItemsFilePath, 'utf-8').split('\n').filter(id => id.trim());
        if (sentItems.length > 150) {
            sentItems = sentItems.slice(sentItems.length - 150); // Keep only the last 150 entries
            fs.writeFileSync(sentItemsFilePath, sentItems.join('\n') + '\n', 'utf-8'); // Ensure each entry is on a new line
            console.log(`Trimmed sent_items.txt to ${sentItems.length} entries.`);
        }
    }
};

// Fetch new asset IDs and update items.txt
const fetchAssetIds = async () => {
    const endpoint = 'https://catalog.roblox.com/v1/search/items?category=11&includeNotForSale=true&limit=120&salesTypeFilter=1&sortType=3';
    try {
        const response = await fetch(endpoint);
        const data = await response.json();
        const ids = data.data.map(item => item.id);
        fs.writeFileSync(itemsFilePath, ids.join('\n'), 'utf-8');
        console.log(`Fetched and saved ${ids.length} IDs to ${itemsFilePath}`);
    } catch (error) {
        console.error('Error fetching asset IDs:', error);
    }
};

// Filter out already sent items from items.txt
const filterItems = () => {
    const sentItems = readIdsFromFile(sentItemsFilePath);
    let itemIds = readIdsFromFile(itemsFilePath);
    itemIds = new Set([...itemIds].filter(id => !sentItems.has(id)));
    fs.writeFileSync(itemsFilePath, [...itemIds].join('\n'), 'utf-8');
    console.log(`Filtered items. ${itemIds.size} items remain.`);
};

// Fetch accessory details
const fetchAccessoryDetails = async (id) => {
    try {
        const response = await fetch(`https://catalog.roblox.com/v1/catalog/items/${id}/details?itemType=Asset`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error(`Error fetching details for asset ID ${id}:`, error);
        return null;
    }
};

// Helper to fetch thumbnail URL
const fetchThumbnailUrl = async (assetId) => {
    try {
        const response = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`);
        const data = await response.json();
        return data.data[0].imageUrl || '';
    } catch (error) {
        console.error(`Error fetching thumbnail for asset ID ${assetId}:`, error);
        return '';
    }
};

// Send Discord webhook
const sendDiscordWebhook = async (accessory) => {
    const isPurchasable = accessory.isPurchasable;
    const price = isPurchasable ? `<:robux:1270902229552992286>${accessory.price}` : '<:robux:1270902229552992286>Offsale';
    const thumbnailUrl = await fetchThumbnailUrl(accessory.id);
    const assetUrl = `https://www.roblox.com/catalog/${accessory.id}/`;

    // Determine the URL for the creator's profile or group
    const creatorUrl = accessory.creatorType === 'User' 
        ? `https://www.roblox.com/users/${accessory.creatorTargetId}/profile`
        : `https://www.roblox.com/groups/${accessory.creatorTargetId}`;

    const embed = {
        title: accessory.name,
        url: assetUrl, // Make the title a link to the asset
        description: accessory.description || '',
        thumbnail: {
            url: thumbnailUrl
        },
        fields: [
            {
                name: 'Price',
                value: price,
                inline: true
            },
            {
                name: 'Creator',
                value: `[${accessory.creatorName}](${creatorUrl})`, // Link the creator's name to their profile or group
                inline: true
            }
        ]
    };

    const payload = {
        embeds: [embed]
    };

    try {
        console.log(`Sending webhook for item ${accessory.id}`);
        const response = await fetch(discordWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const responseData = await response.text(); // Capture the response data

        if (!response.ok) {
            throw new Error(`Failed to send webhook. Status: ${response.status} Response: ${responseData}`);
        }

        console.log(`Successfully sent embed for ${accessory.name} to Discord`);
        return true;  // Indicate success
    } catch (error) {
        console.error('Error sending Discord webhook:', error);
        return false; // Indicate failure
    }
};

// Main processing function
const processItems = async () => {
    await fetchAssetIds();
    filterItems();

    const itemIds = readIdsFromFile(itemsFilePath);
    const sentItems = readIdsFromFile(sentItemsFilePath);

    console.log(`Processing ${itemIds.size} items`);

    for (const id of itemIds) {
        console.log(`Processing item ID ${id}`);

        const details = await fetchAccessoryDetails(id);
        if (details) {
            const success = await sendDiscordWebhook(details);
            if (success) {
                fs.appendFileSync(sentItemsFilePath, `${id}\n`, 'utf-8'); // Ensure new lines for each entry
                limitSentItems(); // Ensure the sent_items.txt file is within the limit
                await delay(15000);  // Wait 15 seconds between webhook messages
            }
        }
    }

    fs.writeFileSync(itemsFilePath, '', 'utf-8');  // Clear items.txt after processing
};

// Run processItems every hour
const runHourly = async () => {
    while (true) {
        await processItems();
        console.log('Waiting for 10 minutes before next run...');
        await delay(600000);  // Wait for 10 minutes
    }
};

runHourly();
