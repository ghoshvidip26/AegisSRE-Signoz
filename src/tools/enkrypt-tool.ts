const options = { method: 'GET', headers: { apikey: 'AQ4wncxCoYkuEmPcqh8BxQyjP9YvQ8Pu' } };

export async function getModels() {
    try {
        const res = await fetch('https://api.enkryptai.com/guardrails/models', options)
        const data = await res.json();
        return data;
    } catch (error) {
        console.error(error)
    }
}