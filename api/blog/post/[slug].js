const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { slug } = req.query;

    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Bad request',
        message: 'A valid slug parameter is required'
      });
    }

    const sanitizedSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '');

    // Look up the post by slug
    const post = getPostBySlug(sanitizedSlug);

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Not found',
        message: `No blog post found with slug: ${sanitizedSlug}`
      });
    }

    // Only serve published posts via public API
    if (post.status !== 'published') {
      return res.status(404).json({
        success: false,
        error: 'Not found',
        message: 'This post is not currently published'
      });
    }

    // Increment view_count (in production this would be async/non-blocking)
    post.view_count = (post.view_count || 0) + 1;

    // Get related posts based on tags
    const relatedPosts = getRelatedPosts(post.slug, post.tags, 3);

    // Structure full post response with enriched metadata
    const response = {
      success: true,
      data: {
        post: {
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          content: post.content,
          content_html: post.content_html || null,
          og_image_url: post.og_image_url,
          published_date: post.published_date,
          updated_date: post.updated_date,
          author: {
            name: post.author.name,
            slug: post.author.slug,
            avatar_url: post.author.avatar_url,
            bio: post.author.bio
          },
          tags: post.tags,
          category: post.category,
          reading_time_minutes: post.reading_time_minutes,
          view_count: post.view_count,
          featured: post.featured || false,
          seo: {
            meta_title: post.seo_title || post.title,
            meta_description: post.seo_description || post.excerpt,
            og_image_url: post.og_image_url,
            canonical_url: `https://singularix.com/blog/${post.slug}`
          },
          table_of_contents: post.table_of_contents || [],
          code_snippets_count: post.code_snippets_count || 0
        },
        related_posts: relatedPosts.map(rp => ({
          id: rp.id,
          title: rp.title,
          slug: rp.slug,
          excerpt: rp.excerpt,
          og_image_url: rp.og_image_url,
          published_date: rp.published_date,
          reading_time_minutes: rp.reading_time_minutes,
          view_count: rp.view_count
        })),
        navigation: getPostNavigation(post.slug)
      },
      meta: {
        generated_at: new Date().toISOString(),
        api_version: '1.0',
        cache_ttl: 300
      }
    };

    // Set cache headers
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching blog post:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to fetch blog post'
    });
  }
};

function getAllPosts() {
  return [
    {
      id: 'post-001',
      title: 'Getting Started with Singularix: A Complete Guide',
      slug: 'getting-started-with-singularix',
      excerpt: 'Learn how to set up and configure Singularix for your enrichment workflows.',
      content: '# Getting Started with Singularix\n\nWelcome to Singularix! This guide will walk you through setting up your first enrichment pipeline.\n\n## Prerequisites\n\n- Node.js 18+\n- A Singularix API key\n\n## Installation\n\n```bash\nnpm install @singularix/sdk\n```\n\n## Configuration\n\nCreate a `.env` file with your API key:\n\n```\nSINGULARIX_API_KEY=your_key_here\n```\n\n## Your First Enrichment\n\n```javascript\nconst { Singularix } = require(\'@singularix/sdk\');\nconst client = new Singularix();\nconst result = await client.enrich.company({ domain: \'example.com\' });\nconsole.log(result);\n```\n\n## Next Steps\n\nExplore our API reference for more enrichment options.',
      content_html: '<h1>Getting Started with Singularix</h1><p>Welcome to Singularix!</p>',
      og_image_url: 'https://cdn.singularix.com/blog/getting-started-og.png',
      published_date: '2024-01-15T09:00:00Z',
      updated_date: '2024-01-20T14:30:00Z',
      status: 'published',
      author: {
        name: 'Alex Chen',
        slug: 'alex-chen',
        avatar_url: 'https://cdn.singularix.com/authors/alex-chen.jpg',
        bio: 'Lead Developer at Singularix. Passionate about data quality and developer experience.'
      },
      tags: ['tutorial', 'getting-started', 'enrichment'],
      category: 'Tutorials',
      reading_time_minutes: 8,
      view_count: 4520,
      featured: true,
      seo_title: 'Getting Started with Singularix - Complete Setup Guide',
      seo_description: 'Step-by-step guide to setting up Singularix for data enrichment. Install, configure, and run your first enrichment in minutes.',
      table_of_contents: [
        { level: 1, text: 'Getting Started with Singularix', anchor: 'getting-started-with-singularix' },
        { level: 2, text: 'Prerequisites', anchor: 'prerequisites' },
        { level: 2, text: 'Installation', anchor: 'installation' },
        { level: 2, text: 'Configuration', anchor: 'configuration' },
        { level: 2, text: 'Your First Enrichment', anchor: 'your-first-enrichment' },
        { level: 2, text: 'Next Steps', anchor: 'next-steps' }
      ],
      code_snippets_count: 3
    },
    {
      id: 'post-002',
      title: 'Data Enrichment Best Practices for B2B Companies',
      slug: 'data-enrichment-best-practices-b2b',
      excerpt: 'Discover the top strategies for enriching your B2B data pipeline.',
      content: '# Data Enrichment Best Practices\n\nEnriching B2B data requires a thoughtful approach...',
      content_html: '<h1>Data Enrichment Best Practices</h1>',
      og_image_url: 'https://cdn.singularix.com/blog/b2b-enrichment-og.png',
      published_date: '2024-02-01T10:00:00Z',
      updated_date: '2024-02-01T10:00:00Z',
      status: 'published',
      author: {
        name: 'Sarah Kim',
        slug: 'sarah-kim',
        avatar_url: 'https://cdn.singularix.com/authors/sarah-kim.jpg',
        bio: 'Product Manager at Singularix focused on data quality solutions.'
      },
      tags: ['best-practices', 'b2b', 'enrichment', 'data-quality'],
      category: 'Best Practices',
      reading_time_minutes: 12,
      view_count: 3210,
      featured: false,
      table_of_contents: [
        { level: 1, text: 'Data Enrichment Best Practices', anchor: 'data-enrichment-best-practices' }
      ],
      code_snippets_count: 0
    },
    {
      id: 'post-003',
      title: 'Announcing Singularix v2.0: What\'s New',
      slug: 'singularix-v2-whats-new',
      excerpt: 'We are excited to announce Singularix v2.0 with new enrichment sources and faster processing.',
      content: '# Singularix v2.0\n\nWe are thrilled to announce the release of Singularix v2.0...',
      content_html: '<h1>Singularix v2.0</h1>',
      og_image_url: 'https://cdn.singularix.com/blog/v2-announcement-og.png',
      published_date: '2024-03-01T08:00:00Z',
      updated_date: '2024-03-05T16:00:00Z',
      status: 'published',
      author: {
        name: 'Alex Chen',
        slug: 'alex-chen',
        avatar_url: 'https://cdn.singularix.com/authors/alex-chen.jpg',
        bio: 'Lead Developer at Singularix.'
      },
      tags: ['announcement', 'product-update', 'v2'],
      category: 'Announcements',
      reading_time_minutes: 5,
      view_count: 8930,
      featured: true,
      table_of_contents: [],
      code_snippets_count: 0
    },
    {
      id: 'post-004',
      title: 'Building RSS Feeds for Your Data Pipeline',
      slug: 'building-rss-feeds-data-pipeline',
      excerpt: 'How to leverage RSS feeds as a data source for real-time enrichment.',
      content: '# Building RSS Feeds for Your Data Pipeline\n\nRSS feeds are an underutilized data source...',
      content_html: '<h1>Building RSS Feeds for Your Data Pipeline</h1>',
      og_image_url: 'https://cdn.singularix.com/blog/rss-feeds-og.png',
      published_date: '2024-03-15T11:00:00Z',
      updated_date: '2024-03-15T11:00:00Z',
      status: 'published',
      author: {
        name: 'Sarah Kim',
        slug: 'sarah-kim',
        avatar_url: 'https://cdn.singularix.com/authors/sarah-kim.jpg',
        bio: 'Product Manager at Singularix.'
      },
      tags: ['rss', 'data-pipeline', 'integration', 'tutorial'],
      category: 'Tutorials',
      reading_time_minutes: 10,
      view_count: 2150,
      featured: false,
      table_of_contents: [],
      code_snippets_count: 2
    },
    {
      id: 'post-005',
      title: 'Company Enrichment API: Deep Dive',
      slug: 'company-enrichment-api-deep-dive',
      excerpt: 'A technical deep dive into our company enrichment API.',
      content: '# Company Enrichment API: Deep Dive\n\nOur company enrichment endpoint provides comprehensive data...',
      content_html: '<h1>Company Enrichment API: Deep Dive</h1>',
      og_image_url: 'https://cdn.singularix.com/blog/company-api-og.png',
      published_date: '2024-04-01T09:00:00Z',
      updated_date: '2024-04-10T13:00:00Z',
      status: 'published',
      author: {
        name: 'Alex Chen',
        slug: 'alex-chen',
        avatar_url: 'https://cdn.singularix.com/authors/alex-chen.jpg',
        bio: 'Lead Developer at Singularix.'
      },
      tags: ['api', 'company-enrichment', 'technical', 'deep-dive'],
      category: 'Technical',
      reading_time_minutes: 15,
      view_count: 6780,
      featured: true,
      table_of_contents: [],
      code_snippets_count: 5
    }
  ];
}

function getPostBySlug(slug) {
  const posts = getAllPosts();
  return posts.find(p => p.slug === slug) || null;
}

function getRelatedPosts(currentSlug, tags, limit) {
  const posts = getAllPosts().filter(p => p.slug !== currentSlug && p.status === 'published');

  // Score posts by number of shared tags
  const scored = posts.map(post => {
    const sharedTags = post.tags.filter(t => tags.includes(t)).length;
    return { post, score: sharedTags };
  });

  scored.sort((a, b) => b.score - a.score || b.post.view_count - a.post.view_count);

  return scored.slice(0, limit).map(s => s.post);
}

function getPostNavigation(currentSlug) {
  const posts = getAllPosts()
    .filter(p => p.status === 'published')
    .sort((a, b) => new Date(a.published_date) - new Date(b.published_date));

  const currentIndex = posts.findIndex(p => p.slug === currentSlug);

  const prev = currentIndex > 0 ? {
    title: posts[currentIndex - 1].title,
    slug: posts[currentIndex - 1].slug
  } : null;

  const next = currentIndex < posts.length - 1 ? {
    title: posts[currentIndex + 1].title,
    slug: posts[currentIndex + 1].slug
  } : null;

  return { previous: prev, next: next };
}
