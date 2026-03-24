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
    const {
      page = 1,
      limit = 10,
      tag = null,
      author = null,
      sort = 'published_date',
      order = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));

    // Simulated blog posts data store
    // In production, this would query a database or CMS
    let posts = getBlogPosts();

    // Filter by tag
    if (tag) {
      posts = posts.filter(post =>
        post.tags.some(t => t.toLowerCase() === tag.toLowerCase())
      );
    }

    // Filter by author
    if (author) {
      posts = posts.filter(post =>
        post.author.slug === author || post.author.name.toLowerCase().includes(author.toLowerCase())
      );
    }

    // Only return published posts
    posts = posts.filter(post => post.status === 'published');

    // Sort posts
    const sortField = ['published_date', 'view_count', 'title'].includes(sort) ? sort : 'published_date';
    const sortOrder = order === 'asc' ? 1 : -1;

    posts.sort((a, b) => {
      if (sortField === 'published_date') {
        return sortOrder * (new Date(a.published_date) - new Date(b.published_date));
      }
      if (sortField === 'view_count') {
        return sortOrder * (a.view_count - b.view_count);
      }
      if (sortField === 'title') {
        return sortOrder * a.title.localeCompare(b.title);
      }
      return 0;
    });

    // Pagination
    const totalPosts = posts.length;
    const totalPages = Math.ceil(totalPosts / limitNum);
    const offset = (pageNum - 1) * limitNum;
    const paginatedPosts = posts.slice(offset, offset + limitNum);

    // Structure response with summary fields (not full content)
    const postSummaries = paginatedPosts.map(post => ({
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      og_image_url: post.og_image_url,
      published_date: post.published_date,
      updated_date: post.updated_date,
      author: {
        name: post.author.name,
        slug: post.author.slug,
        avatar_url: post.author.avatar_url
      },
      tags: post.tags,
      category: post.category,
      reading_time_minutes: post.reading_time_minutes,
      view_count: post.view_count,
      featured: post.featured || false
    }));

    return res.status(200).json({
      success: true,
      data: {
        posts: postSummaries,
        pagination: {
          current_page: pageNum,
          per_page: limitNum,
          total_posts: totalPosts,
          total_pages: totalPages,
          has_next: pageNum < totalPages,
          has_prev: pageNum > 1
        },
        filters_applied: {
          tag: tag || null,
          author: author || null,
          sort: sortField,
          order: order === 'asc' ? 'asc' : 'desc'
        }
      },
      meta: {
        generated_at: new Date().toISOString(),
        api_version: '1.0'
      }
    });
  } catch (error) {
    console.error('Error fetching blog posts:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to fetch blog posts'
    });
  }
};

function getBlogPosts() {
  return [
    {
      id: 'post-001',
      title: 'Getting Started with Singularix: A Complete Guide',
      slug: 'getting-started-with-singularix',
      excerpt: 'Learn how to set up and configure Singularix for your enrichment workflows. This guide covers installation, API keys, and your first data enrichment.',
      content: 'Full markdown content here...',
      og_image_url: 'https://cdn.singularix.com/blog/getting-started-og.png',
      published_date: '2024-01-15T09:00:00Z',
      updated_date: '2024-01-20T14:30:00Z',
      status: 'published',
      author: {
        name: 'Alex Chen',
        slug: 'alex-chen',
        avatar_url: 'https://cdn.singularix.com/authors/alex-chen.jpg',
        bio: 'Lead Developer at Singularix'
      },
      tags: ['tutorial', 'getting-started', 'enrichment'],
      category: 'Tutorials',
      reading_time_minutes: 8,
      view_count: 4520,
      featured: true
    },
    {
      id: 'post-002',
      title: 'Data Enrichment Best Practices for B2B Companies',
      slug: 'data-enrichment-best-practices-b2b',
      excerpt: 'Discover the top strategies for enriching your B2B data pipeline. From company data to contact information, learn what works.',
      content: 'Full markdown content here...',
      og_image_url: 'https://cdn.singularix.com/blog/b2b-enrichment-og.png',
      published_date: '2024-02-01T10:00:00Z',
      updated_date: '2024-02-01T10:00:00Z',
      status: 'published',
      author: {
        name: 'Sarah Kim',
        slug: 'sarah-kim',
        avatar_url: 'https://cdn.singularix.com/authors/sarah-kim.jpg',
        bio: 'Product Manager at Singularix'
      },
      tags: ['best-practices', 'b2b', 'enrichment', 'data-quality'],
      category: 'Best Practices',
      reading_time_minutes: 12,
      view_count: 3210,
      featured: false
    },
    {
      id: 'post-003',
      title: 'Announcing Singularix v2.0: What\'s New',
      slug: 'singularix-v2-whats-new',
      excerpt: 'We are excited to announce Singularix v2.0 with new enrichment sources, faster processing, and a completely redesigned dashboard.',
      content: 'Full markdown content here...',
      og_image_url: 'https://cdn.singularix.com/blog/v2-announcement-og.png',
      published_date: '2024-03-01T08:00:00Z',
      updated_date: '2024-03-05T16:00:00Z',
      status: 'published',
      author: {
        name: 'Alex Chen',
        slug: 'alex-chen',
        avatar_url: 'https://cdn.singularix.com/authors/alex-chen.jpg',
        bio: 'Lead Developer at Singularix'
      },
      tags: ['announcement', 'product-update', 'v2'],
      category: 'Announcements',
      reading_time_minutes: 5,
      view_count: 8930,
      featured: true
    },
    {
      id: 'post-004',
      title: 'Building RSS Feeds for Your Data Pipeline',
      slug: 'building-rss-feeds-data-pipeline',
      excerpt: 'How to leverage RSS feeds as a data source for real-time enrichment. Includes code examples and integration patterns.',
      content: 'Full markdown content here...',
      og_image_url: 'https://cdn.singularix.com/blog/rss-feeds-og.png',
      published_date: '2024-03-15T11:00:00Z',
      updated_date: '2024-03-15T11:00:00Z',
      status: 'published',
      author: {
        name: 'Sarah Kim',
        slug: 'sarah-kim',
        avatar_url: 'https://cdn.singularix.com/authors/sarah-kim.jpg',
        bio: 'Product Manager at Singularix'
      },
      tags: ['rss', 'data-pipeline', 'integration', 'tutorial'],
      category: 'Tutorials',
      reading_time_minutes: 10,
      view_count: 2150,
      featured: false
    },
    {
      id: 'post-005',
      title: 'Company Enrichment API: Deep Dive',
      slug: 'company-enrichment-api-deep-dive',
      excerpt: 'A technical deep dive into our company enrichment API. Learn about data sources, accuracy rates, and advanced query parameters.',
      content: 'Full markdown content here...',
      og_image_url: 'https://cdn.singularix.com/blog/company-api-og.png',
      published_date: '2024-04-01T09:00:00Z',
      updated_date: '2024-04-10T13:00:00Z',
      status: 'published',
      author: {
        name: 'Alex Chen',
        slug: 'alex-chen',
        avatar_url: 'https://cdn.singularix.com/authors/alex-chen.jpg',
        bio: 'Lead Developer at Singularix'
      },
      tags: ['api', 'company-enrichment', 'technical', 'deep-dive'],
      category: 'Technical',
      reading_time_minutes: 15,
      view_count: 6780,
      featured: true
    }
  ];
}
