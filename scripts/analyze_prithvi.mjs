async function run() {
  try {
    const res = await fetch('https://prithvi-twin.vercel.app/');
    console.log('Status:', res.status);
    const html = await res.text();
    console.log('HTML length:', html.length);
    console.log('Title:', html.match(/<title>(.*?)<\/title>/)?.[1]);

    const cssMatches = [...html.matchAll(/href=["']([^"']+\.css[^"']*)["']/g)].map(m => m[1]);
    console.log('CSS links:', cssMatches);

    for (const cssRel of cssMatches) {
      const url = cssRel.startsWith('http') ? cssRel : 'https://prithvi-twin.vercel.app' + (cssRel.startsWith('/') ? '' : '/') + cssRel;
      console.log('Fetching CSS:', url);
      const cRes = await fetch(url);
      const text = await cRes.text();
      console.log('CSS length:', text.length);

      const rootVars = [...text.matchAll(/--[a-zA-Z0-9_-]+:[^;]+;/g)].map(m => m[0]);
      console.log('CSS Variables found:', rootVars.length);
      console.log('Top 40 CSS vars:\n', rootVars.slice(0, 40).join('\n'));

      const hexColors = [...new Set([...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]))];
      console.log('Distinct Hex colors (40):', hexColors.slice(0, 40));

      const rgbColors = [...new Set([...text.matchAll(/rgba?\([^)]+\)/g)].map(m => m[0]))];
      console.log('Distinct RGB colors (20):', rgbColors.slice(0, 20));
    }

    // Inspect first 2000 chars of HTML body to understand layout and classes
    const bodyStart = html.indexOf('<body');
    if (bodyStart !== -1) {
      console.log('Body start:\n', html.slice(bodyStart, bodyStart + 1500));
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

run();

