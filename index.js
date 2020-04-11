const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');

async function queryGithub(query, variables, githubToken) {
  console.log(`Query body: ${JSON.stringify({ query, variables })}`);
    return fetch('https://api.github.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `bearer ${githubToken}`
      }
    }).then(function(response) {
      return response.json();
    });
  }
  
  function isIssueCard(contentUrl) {
    return contentUrl.split('/').find(x=> x === 'issues').length;
  }

  function getIssueNumber(contentUrl) {
    const urlParts = contentUrl.split('/');
    return urlParts[urlParts.length - 1];
  }

  async function getIssueData(repositoryOwner, repositoryName, issueNumber, githubToken) {
    const issueQuery = `
      query($owner:String!, $name:String!, $number:Int!){
          repository(owner: $owner, name: $name) {
              issue(number:$number) {
                id
                state
                title
                projectCards {
                  nodes {
                    project {
                      number
                    }
                  }
                }
              }
          }
      }`;

    const parameters = {
        owner: repositoryOwner,
        name: repositoryName,
        number: parseInt(issueNumber)
    };

    const response = await queryGithub(issueQuery, parameters, githubToken);

    const str = JSON.stringify(response, undefined, 2);
    
    console.log(`Issue data: ${str}`);

    return response['data']['repository']['issue'];
  }

  async function getProjectId(repositoryOwner, repositoryName, projectNumber, githubToken) {
      const projectIdQuery = `
        query($owner:String!, $name:String!, $number:Int!){
            repository(owner: $owner, name: $name) {
                project(number: $number) {
                    id
                }
            }
        }`;
      
      const parameters = {
        owner: repositoryOwner,
        name: repositoryName,
        number: parseInt(projectNumber)
      };

      const response = await queryGithub(projectIdQuery, parameters, githubToken);
      console.log(response);
      
      return response['data']['repository']['project']['id'];
  }

  async function getLabelId(repositoryOwner, repositoryName, labelName, githubToken) {
    const query = `
      query($owner:String!, $name:String!, $labelName:String!){
          repository(owner: $owner, name: $name) {
              label(name: $labelName) {
                  id
              }
          }
      }`;
    
    const parameters = {
      owner: repositoryOwner,
      name: repositoryName,
      labelName: labelName
    };

    const response = await queryGithub(query, parameters, githubToken);
    console.log(response);
    
    return response['data']['repository']['label']['id'];
  }

  async function getRepositoryId(repositoryOwner, repositoryName, githubToken) {
    const query = `
      query($owner:String!, $name:String!){
          repository(owner: $owner, name: $name) {
            id
          }
      }`;
    
    const parameters = {
      owner: repositoryOwner,
      name: repositoryName
    };

    const response = await queryGithub(query, parameters, githubToken);
    console.log(response);
    
    return response['data']['repository']['id'];
  }

  async function createIssue(assigneeIds, labelIds, repositoryId, projectId, title, githubToken,
    body) {
    const createIssueInput = {
      assigneeIds: assigneeIds,
      body: body,
      clientMutationId: null,
      labelIds: labelIds,
      milestoneId: null,
      projectIds: [ projectId ],
      repositoryId: repositoryId,
      title: title
    };

    query = `
      mutation($createIssue:CreateIssueInput!) {
        createIssue(input:$createIssue) {
          issue {
            id
          }
        }
      }`;
    parameters = { createIssue: createIssueInput };

    const response = await queryGithub(query, parameters, githubToken);

    const str = JSON.stringify(response, undefined, 2);
    
    console.log(`Issue data: ${str}`);
    
}

  async function getAssigneeId(assignee, githubToken) {
    const userQuery = `
        query($name:String!){
          user(login: $name) {
            id
          }
        }`;
    
    const parameters = { name: assignee };

    const response = await queryGithub(userQuery, parameters, githubToken);
    console.log(response);
    
    return response['data']['user']['id'];
  }

  async function run() {
    try {
        
        if (!isIssueCard(github.context.payload.project_card.content_url)) {
            console.log(`Not an issue card: ${github.context.payload.project_card.content_url}`);
            return;
        }

        const repository = core.getInput('repository');
        const githubToken = core.getInput('github_token');
        const repositoryOwner = repository.split('/')[0];
        const repositoryName = repository.split('/')[1];
        const targetProject = core.getInput('targetProject');
        const validationProject = core.getInput('validationProject');
        const newIssueSuffix = core.getInput('newIssueSuffix');
        const assigneesInput = core.getInput('assignees').split(',');
        const labelsInput = core.getInput('labels').split(',');

        if (!assigneesInput.length) {
            console.log('Assignees missing');
            throw('Assignees missing');
        }

        if (!labelsInput.length) {
            console.log('Labels missing');
            throw('Labels missing');
        }

        const issueNumber = getIssueNumber(github.context.payload.project_card.content_url);

        const issueData = await getIssueData(repositoryOwner, repositoryName, 
            issueNumber, githubToken);
        
        if (!issueData) {
            console.log(`Issue ${issueNumber} not found`);
            throw(`Issue ${issueNumber} not found`);
        }

        if (issueData.state.toLowerCase() != 'closed') {
            console.log(`Issue ${issueNumber} not closed! Issue state is ${issueData.state}`);
            return;
        }

        if (!issueData.projectCards.nodes.length 
          || !(issueData.projectCards.nodes.find(x=> x.number == parseInt(validationProject)))) {
            console.log(`Issue ${issueNumber} is not associated with validation project ${validationProject}`);
            return;
        }

        const newIssueTitle = `${issueData.title} ${newIssueSuffix}`;
        console.log('Before project id');
        const targetProjectId = await getProjectId(repositoryOwner, repositoryName,
            targetProject, githubToken);

        if (!targetProjectId) {
            console.log('Target project not found!');
            throw('Target project not found!');
        }

        console.log('Before assignees');

        const assigneeIds = [];
        for(let i = 0; i < assigneesInput.length; i++) {
          const id = await getAssigneeId(assigneesInput[i], githubToken);
          if(!id) {
              console.log(`Invalid assignee ${assigneesInput[i]}`);
              throw(`Invalid assignee ${assigneesInput[i]}`);
          }
          assigneeIds.push(id);
        }

        console.log('Before labels');

        const labelIds = [];
        for(let i = 0; i < labelsInput.length; i++) {
          const id = await getLabelId(repositoryOwner, repositoryName, labelsInput[i], githubToken);
          if(!id) {
              console.log(`Invalid assignee ${labelsInput[i]}`);
              throw(`Invalid assignee ${labelsInput[i]}`);
          }
          labelIds.push(id);
        }

        console.log('Before repoid');

        const repositoryId = await getRepositoryId(repositoryOwner, repositoryName, githubToken);

        console.log('Before create issue');

        const body = `A new issue has been completed, #${issueNumber}. Please test it.`

        await createIssue(assigneeIds, labelIds, repositoryId, targetProjectId, 
            newIssueTitle, githubToken, body);

        console.log(`Done!`);
    } catch (error) {
      core.setFailed(error.message);
    }
  }
  
  run();