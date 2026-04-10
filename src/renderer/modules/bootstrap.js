// Load renderer modules through CommonJS so each file gets module scope
// and relative requires resolve from its own file location.
const moduleLoadOrder = [
	"./renderer",
	"./billPanelResize",
	"./table",
	"./bill",
	"./ui",
	"./menu",
	"./history",
	"./todaysOrders",
	"./deletedOrdersTable",
	"./help",
];

for (const modulePath of moduleLoadOrder) {
	try {
		const resolved = require.resolve(modulePath);
		// In dev, renderer reloads can keep module cache alive in-process.
		// Clearing cache ensures latest file contents are loaded.
		if (require.cache[resolved]) {
			delete require.cache[resolved];
		}
		require(modulePath);
	} catch (error) {
		console.error(`[bootstrap] Failed to load ${modulePath}:`, error);
		throw error;
	}
}
