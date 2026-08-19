const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;

// Custom-domain builds do not always receive Base44's Vite environment values.
// These identifiers are public client configuration (not secrets) and keep every
// browser entry path pointed at the correct Base44 application.
export const DEFAULT_BASE44_APP_ID = '6925fec3678942d22522b010';
export const DEFAULT_BASE44_BACKEND_URL = 'https://base44.app';

const normalizeParamValue = (value) => {
	if (value === null || value === undefined) return null;
	const normalized = String(value).trim();
	if (!normalized || normalized === 'null' || normalized === 'undefined') return null;
	return normalized;
};

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

export const shouldUseFunctionsVersion = (hostname = '') => {
	const normalized = String(hostname || '').trim().toLowerCase();
	return normalized === 'app.base44.com'
		|| normalized === 'base44.app'
		|| normalized.endsWith('.base44.app');
};

// A function version is an editor-preview routing hint, not durable app state.
// Reusing a value from localStorage can pair a newly deployed UI with an older
// backend bundle and make otherwise valid function payloads fail with HTTP 400.
export const resolveFunctionsVersion = ({ hostname = '', search = '' } = {}) => {
	// This source-controlled application always targets the latest deployed
	// backend bundle. Allowing an editor/browser URL to pin an older function
	// version can make the current UI send newly supported record types to an
	// obsolete query function and produce HTTP 400 responses.
	void hostname;
	void search;
	return null;
};

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const storageKey = `base44_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = normalizeParamValue(urlParams.get(paramName));
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		storage.setItem(storageKey, searchParam);
		return searchParam;
	}
	const normalizedDefaultValue = normalizeParamValue(defaultValue);
	if (normalizedDefaultValue) {
		storage.setItem(storageKey, normalizedDefaultValue);
		return normalizedDefaultValue;
	}
	const storedValue = normalizeParamValue(storage.getItem(storageKey));
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	const functionsVersion = (() => {
		if (isNode) return null;
		// Never allow an editor version to survive navigation or a deployment.
		storage.removeItem('base44_functions_version');
		return null;
	})();
	return {
		appId: getAppParamValue("app_id", {
			defaultValue: import.meta.env.VITE_BASE44_APP_ID || DEFAULT_BASE44_APP_ID
		}),
		serverUrl: getAppParamValue("server_url", {
			defaultValue: import.meta.env.VITE_BASE44_BACKEND_URL || DEFAULT_BASE44_BACKEND_URL
		}),
		token: getAppParamValue("access_token", { removeFromUrl: true }),
		fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
		functionsVersion,
	}
}


export const appParams = {
	...getAppParams()
}
