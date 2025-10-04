#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";

interface BitbucketConfig {
  email: string;
  apiToken: string;
}

interface Comment {
  id: number;
  content: {
    raw: string;
  };
  user: {
    display_name: string;
  };
  created_on: string;
  inline?: {
    path: string;
    to?: number;
    from?: number;
  };
  deleted: boolean;
}

interface Task {
  id: number;
  content: {
    raw: string;
  };
  state: string;
  creator: {
    display_name: string;
  };
  created_on: string;
}

class BitbucketMCPServer {
  private server: Server;
  private axiosClient: AxiosInstance;
  private config: BitbucketConfig;

  constructor() {
    this.server = new Server(
      {
        name: "bitbucket-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Load configuration from environment variables
    // Requires: BITBUCKET_EMAIL and BITBUCKET_API_TOKEN
    const email = process.env.BITBUCKET_EMAIL;
    const apiToken = process.env.BITBUCKET_API_TOKEN;

    if (!email || !apiToken) {
      throw new Error(
        "BITBUCKET_EMAIL and BITBUCKET_API_TOKEN are required.\n" +
        "See: https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/"
      );
    }

    this.config = {
      email,
      apiToken,
    };

    // Create axios client with Basic Authentication (email:api_token)
    // API tokens use Basic Auth, not Bearer tokens
    this.axiosClient = axios.create({
      baseURL: "https://api.bitbucket.org/2.0",
      headers: {
        "Content-Type": "application/json",
      },
      auth: {
        username: this.config.email,
        password: this.config.apiToken,
      },
    });

    this.setupHandlers();
    
    // Error handling
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_pr_comments",
            description: "Fetch all comments from a Bitbucket pull request. Requires workspace, repository, and PR ID.",
            inputSchema: {
              type: "object",
              properties: {
                workspace: {
                  type: "string",
                  description: "Bitbucket workspace name (e.g., 'mycompany')",
                },
                repository: {
                  type: "string",
                  description: "Repository slug (e.g., 'my-repo')",
                },
                pr_id: {
                  type: "number",
                  description: "The pull request ID/number",
                },
              },
              required: ["workspace", "repository", "pr_id"],
            },
          },
          {
            name: "get_pr_tasks",
            description: "Fetch all tasks from a Bitbucket pull request. Requires workspace, repository, and PR ID.",
            inputSchema: {
              type: "object",
              properties: {
                workspace: {
                  type: "string",
                  description: "Bitbucket workspace name (e.g., 'mycompany')",
                },
                repository: {
                  type: "string",
                  description: "Repository slug (e.g., 'my-repo')",
                },
                pr_id: {
                  type: "number",
                  description: "The pull request ID/number",
                },
              },
              required: ["workspace", "repository", "pr_id"],
            },
          },
          {
            name: "get_pr_info",
            description: "Fetch complete pull request information including description, status, and metadata. Requires workspace, repository, and PR ID.",
            inputSchema: {
              type: "object",
              properties: {
                workspace: {
                  type: "string",
                  description: "Bitbucket workspace name (e.g., 'mycompany')",
                },
                repository: {
                  type: "string",
                  description: "Repository slug (e.g., 'my-repo')",
                },
                pr_id: {
                  type: "number",
                  description: "The pull request ID/number",
                },
              },
              required: ["workspace", "repository", "pr_id"],
            },
          },
          {
            name: "get_pr_diff",
            description: "Fetch the diff/changes from a Bitbucket pull request. Requires workspace, repository, and PR ID.",
            inputSchema: {
              type: "object",
              properties: {
                workspace: {
                  type: "string",
                  description: "Bitbucket workspace name (e.g., 'mycompany')",
                },
                repository: {
                  type: "string",
                  description: "Repository slug (e.g., 'my-repo')",
                },
                pr_id: {
                  type: "number",
                  description: "The pull request ID/number",
                },
              },
              required: ["workspace", "repository", "pr_id"],
            },
          },
          {
            name: "list_my_open_prs",
            description: "List all open pull requests created by the current user across all repositories in a workspace.",
            inputSchema: {
              type: "object",
              properties: {
                workspace: {
                  type: "string",
                  description: "Bitbucket workspace name (e.g., 'mycompany')",
                },
              },
              required: ["workspace"],
            },
          },
        ] as Tool[],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "get_pr_comments") {
          return await this.getPRComments(args);
        } else if (name === "get_pr_tasks") {
          return await this.getPRTasks(args);
        } else if (name === "get_pr_info") {
          return await this.getPRInfo(args);
        } else if (name === "get_pr_diff") {
          return await this.getPRDiff(args);
        } else if (name === "list_my_open_prs") {
          return await this.listMyOpenPRs(args);
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  private async getPRComments(args: any) {
    const workspace = args.workspace;
    const repository = args.repository;
    const prId = args.pr_id;

    if (!workspace || !repository || !prId) {
      throw new Error("workspace, repository, and pr_id are required");
    }

    const response = await this.axiosClient.get(
      `/repositories/${workspace}/${repository}/pullrequests/${prId}/comments`
    );

    const comments = response.data.values as Comment[];
    
    let formattedComments = `# Pull Request #${prId} Comments\n\n`;
    formattedComments += `Found ${comments.length} comments\n\n`;
    
    comments.forEach((comment, index) => {
      if (comment.deleted) return;
      
      formattedComments += `## Comment ${index + 1}\n`;
      formattedComments += `**Author**: ${comment.user.display_name}\n`;
      formattedComments += `**Date**: ${new Date(comment.created_on).toLocaleString()}\n`;
      
      if (comment.inline) {
        formattedComments += `**File**: ${comment.inline.path}\n`;
        if (comment.inline.to) {
          formattedComments += `**Line**: ${comment.inline.to}\n`;
        }
      } else {
        formattedComments += `**Type**: General comment\n`;
      }
      
      formattedComments += `\n${comment.content.raw}\n\n`;
      formattedComments += `---\n\n`;
    });

    return {
      content: [
        {
          type: "text",
          text: formattedComments,
        },
      ],
    };
  }

  private async getPRTasks(args: any) {
    const workspace = args.workspace;
    const repository = args.repository;
    const prId = args.pr_id;

    if (!workspace || !repository || !prId) {
      throw new Error("workspace, repository, and pr_id are required");
    }

    // First get all comments, then filter for tasks
    const response = await this.axiosClient.get(
      `/repositories/${workspace}/${repository}/pullrequests/${prId}/comments`
    );

    const allComments = response.data.values;
    
    // Tasks in Bitbucket are special types of comments with a task property
    // We need to check each comment for task status
    const tasks: any[] = [];
    
    for (const comment of allComments) {
      if (comment.deleted) continue;
      
      // Check if this comment has task data
      try {
        const taskResponse = await this.axiosClient.get(
          `/repositories/${workspace}/${repository}/pullrequests/${prId}/comments/${comment.id}`
        );
        
        if (taskResponse.data.type === 'pullrequest_comment' && taskResponse.data.inline?.task) {
          tasks.push(taskResponse.data);
        }
      } catch (error) {
        // Comment might not be a task, continue
      }
    }

    let formattedTasks = `# Pull Request #${prId} Tasks\n\n`;
    formattedTasks += `Found ${tasks.length} tasks\n\n`;
    
    tasks.forEach((task, index) => {
      formattedTasks += `## Task ${index + 1}\n`;
      formattedTasks += `**Status**: ${task.inline?.task?.state || 'UNRESOLVED'}\n`;
      formattedTasks += `**Creator**: ${task.user.display_name}\n`;
      formattedTasks += `**Date**: ${new Date(task.created_on).toLocaleString()}\n`;
      
      if (task.inline) {
        formattedTasks += `**File**: ${task.inline.path}\n`;
        if (task.inline.to) {
          formattedTasks += `**Line**: ${task.inline.to}\n`;
        }
      }
      
      formattedTasks += `\n${task.content.raw}\n\n`;
      formattedTasks += `---\n\n`;
    });

    return {
      content: [
        {
          type: "text",
          text: formattedTasks,
        },
      ],
    };
  }

  private async getPRInfo(args: any) {
    const workspace = args.workspace;
    const repository = args.repository;
    const prId = args.pr_id;

    if (!workspace || !repository || !prId) {
      throw new Error("workspace, repository, and pr_id are required");
    }

    const response = await this.axiosClient.get(
      `/repositories/${workspace}/${repository}/pullrequests/${prId}`
    );

    const pr = response.data;
    
    let formattedInfo = `# Pull Request #${prId}\n\n`;
    formattedInfo += `**Title**: ${pr.title}\n`;
    formattedInfo += `**State**: ${pr.state}\n`;
    formattedInfo += `**Author**: ${pr.author.display_name}\n`;
    formattedInfo += `**Created**: ${new Date(pr.created_on).toLocaleString()}\n`;
    formattedInfo += `**Updated**: ${new Date(pr.updated_on).toLocaleString()}\n`;
    formattedInfo += `**Source**: ${pr.source.branch.name}\n`;
    formattedInfo += `**Destination**: ${pr.destination.branch.name}\n`;
    formattedInfo += `\n## Description\n\n${pr.description || 'No description provided'}\n`;

    return {
      content: [
        {
          type: "text",
          text: formattedInfo,
        },
      ],
    };
  }

  private async getPRDiff(args: any) {
    const workspace = args.workspace;
    const repository = args.repository;
    const prId = args.pr_id;

    if (!workspace || !repository || !prId) {
      throw new Error("workspace, repository, and pr_id are required");
    }

    const response = await this.axiosClient.get(
      `/repositories/${workspace}/${repository}/pullrequests/${prId}/diff`,
      {
        headers: {
          Accept: "text/plain",
        },
      }
    );

    return {
      content: [
        {
          type: "text",
          text: `# Pull Request #${prId} Diff\n\n\`\`\`diff\n${response.data}\n\`\`\``,
        },
      ],
    };
  }

  private async listMyOpenPRs(args: any) {
    const workspace = args.workspace;

    if (!workspace) {
      throw new Error("workspace is required");
    }

    // Get the current user's UUID to filter PRs
    const userResponse = await this.axiosClient.get('/user');
    const currentUserUuid = userResponse.data.uuid;

    // Get all repositories in the workspace
    const reposResponse = await this.axiosClient.get(
      `/repositories/${workspace}`,
      {
        params: {
          pagelen: 100, // Get up to 100 repositories per page
        }
      }
    );

    const repositories = reposResponse.data.values;
    const allPRs: any[] = [];

    // For each repository, get open PRs created by the current user
    for (const repo of repositories) {
      try {
        const prsResponse = await this.axiosClient.get(
          `/repositories/${workspace}/${repo.slug}/pullrequests`,
          {
            params: {
              state: 'OPEN',
              'author.uuid': currentUserUuid,
              pagelen: 50,
            }
          }
        );

        const prs = prsResponse.data.values;
        // Add repository information to each PR
        prs.forEach((pr: any) => {
          pr.repository_name = repo.name;
          pr.repository_slug = repo.slug;
        });
        
        allPRs.push(...prs);
      } catch (error: any) {
        // Repository might not have PRs or user might not have access
        // Continue with next repository
        console.error(`Error fetching PRs for ${repo.slug}: ${error.message}`);
      }
    }

    // Sort PRs by created date (newest first)
    allPRs.sort((a, b) => new Date(b.created_on).getTime() - new Date(a.created_on).getTime());

    let formattedPRs = `# My Open Pull Requests in ${workspace}\n\n`;
    formattedPRs += `Found ${allPRs.length} open pull request(s)\n\n`;

    if (allPRs.length === 0) {
      formattedPRs += `No open pull requests found for the current user.\n`;
    } else {
      allPRs.forEach((pr, index) => {
        formattedPRs += `## ${index + 1}. ${pr.title}\n`;
        formattedPRs += `**Repository**: ${pr.repository_name} (${pr.repository_slug})\n`;
        formattedPRs += `**PR ID**: #${pr.id}\n`;
        formattedPRs += `**State**: ${pr.state}\n`;
        formattedPRs += `**Source → Destination**: ${pr.source.branch.name} → ${pr.destination.branch.name}\n`;
        formattedPRs += `**Created**: ${new Date(pr.created_on).toLocaleString()}\n`;
        formattedPRs += `**Updated**: ${new Date(pr.updated_on).toLocaleString()}\n`;
        formattedPRs += `**Link**: ${pr.links.html.href}\n`;
        
        if (pr.description) {
          const shortDescription = pr.description.length > 150 
            ? pr.description.substring(0, 150) + '...' 
            : pr.description;
          formattedPRs += `**Description**: ${shortDescription}\n`;
        }
        
        formattedPRs += `\n---\n\n`;
      });
    }

    return {
      content: [
        {
          type: "text",
          text: formattedPRs,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Bitbucket MCP server running on stdio");
  }
}

const server = new BitbucketMCPServer();
server.run().catch(console.error);
